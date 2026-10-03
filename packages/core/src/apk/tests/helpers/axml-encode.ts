const ANDROID_NS = 'http://schemas.android.com/apk/res/android';

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function align4(bytes: Uint8Array): Uint8Array {
  const padding = (4 - (bytes.byteLength % 4)) % 4;
  return padding === 0 ? bytes : concat(bytes, new Uint8Array(padding));
}

function length8(value: number): Uint8Array {
  if (value < 0x80) return new Uint8Array([value]);
  return new Uint8Array([0x80 | (value >>> 8), value & 0xff]);
}

function length16(value: number): Uint8Array {
  if (value < 0x8000) return u16(value);
  return concat(u16(0x8000 | (value >>> 16)), u16(value & 0xffff));
}

function encodeString(value: string, utf8: boolean): Uint8Array {
  if (utf8) {
    const data = new TextEncoder().encode(value);
    return concat(length8(value.length), length8(data.byteLength), data, new Uint8Array([0]));
  }
  const data = new Uint8Array(value.length * 2);
  for (let index = 0; index < value.length; index += 1) {
    new DataView(data.buffer).setUint16(index * 2, value.charCodeAt(index), true);
  }
  return concat(length16(value.length), data, u16(0));
}

function stringPool(values: readonly string[], utf8: boolean): {
  readonly chunk: Uint8Array;
  readonly index: ReadonlyMap<string, number>;
} {
  const unique = [...new Set(values)];
  const encoded = unique.map((value) => encodeString(value, utf8));
  const offsets: Uint8Array[] = [];
  let relative = 0;
  for (const value of encoded) {
    offsets.push(u32(relative));
    relative += value.byteLength;
  }
  const strings = align4(concat(...encoded));
  const stringsStart = 28 + offsets.length * 4;
  const chunk = concat(
    u16(0x0001),
    u16(28),
    u32(stringsStart + strings.byteLength),
    u32(unique.length),
    u32(0),
    u32(utf8 ? 0x00000100 : 0),
    u32(stringsStart),
    u32(0),
    ...offsets,
    strings,
  );
  return {
    chunk,
    index: new Map(unique.map((value, index) => [value, index])),
  };
}

function chunk(type: number, body: Uint8Array): Uint8Array {
  return concat(u16(type), u16(16), u32(16 + body.byteLength), body);
}

function namespace(type: number, prefix: number, uri: number): Uint8Array {
  const body = concat(u32(1), u32(0xffffffff), u32(prefix), u32(uri));
  return concat(u16(type), u16(16), u32(24), body);
}

type AttrType = 'string' | 'int';

interface Attr {
  readonly namespace?: string;
  readonly name: string;
  readonly value: string | number;
  readonly type: AttrType;
}

function element(
  pool: ReadonlyMap<string, number>,
  name: string,
  attrs: readonly Attr[],
): Uint8Array {
  const attributes = attrs.map((attr) => {
    const namespace = attr.namespace === undefined ? 0xffffffff : pool.get(attr.namespace);
    const nameIndex = pool.get(attr.name);
    if (namespace === undefined || nameIndex === undefined) throw new Error('Unknown test string.');

    let rawValue = 0xffffffff;
    let data = 0;
    let valueType = 0x10;
    if (attr.type === 'string') {
      const stringIndex = pool.get(String(attr.value));
      if (stringIndex === undefined) throw new Error('Unknown test string.');
      rawValue = stringIndex;
      data = stringIndex;
      valueType = 0x03;
    } else {
      data = Number(attr.value);
    }

    return concat(
      u32(namespace),
      u32(nameIndex),
      u32(rawValue),
      u16(8),
      new Uint8Array([0, valueType]),
      u32(data),
    );
  });
  const nameIndex = pool.get(name);
  if (nameIndex === undefined) throw new Error('Unknown test element.');
  const ext = concat(
    u32(1),
    u32(0xffffffff),
    u32(0xffffffff),
    u32(nameIndex),
    u16(20),
    u16(20),
    u16(attrs.length),
    u16(0),
    u16(0),
    u16(0),
  );
  return concat(
    u16(0x0102),
    u16(16),
    u32(36 + attrs.length * 20),
    ext,
    ...attributes,
  );
}

function endElement(pool: ReadonlyMap<string, number>, name: string): Uint8Array {
  const nameIndex = pool.get(name);
  if (nameIndex === undefined) throw new Error('Unknown test element.');
  const body = concat(u32(1), u32(0xffffffff), u32(0xffffffff), u32(nameIndex));
  return concat(u16(0x0103), u16(16), u32(24), body);
}

export function encodeManifest(options: {
  readonly utf8?: boolean;
  readonly versionName?: string;
  readonly includeVersionName?: boolean;
  readonly includeSdk?: boolean;
  readonly resourceMap?: boolean;
  readonly unknownChunk?: boolean;
} = {}): Uint8Array {
  const versionName = options.versionName ?? '1.2.3';
  const values = [
    'manifest',
    'uses-sdk',
    'package',
    'versionCode',
    'versionName',
    'minSdkVersion',
    'targetSdkVersion',
    ANDROID_NS,
    'android',
    'com.example.test',
    versionName,
  ];
  const pool = stringPool(values, options.utf8 !== false);
  const prefix = pool.index.get('android');
  const uri = pool.index.get(ANDROID_NS);
  if (prefix === undefined || uri === undefined) throw new Error('Missing namespace strings.');

  const manifestAttrs: Attr[] = [
    { name: 'package', value: 'com.example.test', type: 'string' },
    { namespace: ANDROID_NS, name: 'versionCode', value: 42, type: 'int' },
  ];
  if (options.includeVersionName !== false) {
    manifestAttrs.push({ namespace: ANDROID_NS, name: 'versionName', value: versionName, type: 'string' });
  }

  const manifest = element(pool.index, 'manifest', manifestAttrs);
  const sdk = element(pool.index, 'uses-sdk', [
    { namespace: ANDROID_NS, name: 'minSdkVersion', value: 24, type: 'int' },
    { namespace: ANDROID_NS, name: 'targetSdkVersion', value: 35, type: 'int' },
  ]);
  const chunks = [
    namespace(0x0100, prefix, uri),
    manifest,
    ...(options.includeSdk === false ? [] : [sdk]),
    ...(options.includeSdk === false ? [endElement(pool.index, 'manifest')] : [
      endElement(pool.index, 'uses-sdk'),
      endElement(pool.index, 'manifest'),
    ]),
    ...(options.resourceMap ? [concat(u16(0x0180), u16(8), u32(8))] : []),
    ...(options.unknownChunk ? [concat(u16(0x7777), u16(8), u32(8))] : []),
    namespace(0x0101, prefix, uri),
  ];
  return concat(u16(0x0003), u16(8), u32(8), pool.chunk, ...chunks);
}

export const ANDROID_NAMESPACE = ANDROID_NS;
