import { ApkParseError } from './source.js';

export const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;

const XML_HEADER = 0x0003;
const STRING_POOL = 0x0001;
const RESOURCE_MAP = 0x0180;
const START_NAMESPACE = 0x0100;
const END_NAMESPACE = 0x0101;
const START_ELEMENT = 0x0102;
const END_ELEMENT = 0x0103;
const UTF8_FLAG = 0x00000100;
const VALUE_STRING = 0x03;
const VALUE_INT_DEC = 0x10;
const VALUE_INT_HEX = 0x11;
const NO_INDEX = 0xffffffff;
const ANDROID_NS = 'http://schemas.android.com/apk/res/android';

export interface ParsedManifest {
  readonly packageName: string;
  readonly versionCode?: number;
  readonly versionName?: string;
  readonly minSdk?: number;
  readonly targetSdk?: number;
}

interface StringPool {
  readonly strings: string[];
}

interface Attribute {
  readonly namespace: string | undefined;
  readonly name: string;
  readonly type: number;
  readonly data: number;
  readonly value: string | undefined;
}

interface Element {
  readonly name: string;
  readonly attributes: readonly Attribute[];
}

function fail(code: string, message: string): never {
  throw new ApkParseError(code, message);
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function requireRange(bytes: Uint8Array, offset: number, length: number, code = 'APK_AXML_BOUNDS'): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > bytes.byteLength ||
    length > bytes.byteLength - offset
  ) {
    fail(code, 'Android binary XML structure is truncated or out of bounds.');
  }
}

function readU16(bytes: Uint8Array, offset: number, code = 'APK_AXML_BOUNDS'): number {
  requireRange(bytes, offset, 2, code);
  return viewOf(bytes).getUint16(offset, true);
}

function readU32(bytes: Uint8Array, offset: number, code = 'APK_AXML_BOUNDS'): number {
  requireRange(bytes, offset, 4, code);
  return viewOf(bytes).getUint32(offset, true);
}

function chunkBounds(
  bytes: Uint8Array,
  offset: number,
): { readonly type: number; readonly headerSize: number; readonly size: number } {
  requireRange(bytes, offset, 8);
  const type = readU16(bytes, offset);
  const headerSize = readU16(bytes, offset + 2);
  const size = readU32(bytes, offset + 4);
  if (headerSize < 8 || size < headerSize) {
    fail('APK_AXML_CHUNK_INVALID', 'Android binary XML chunk header is invalid.');
  }
  requireRange(bytes, offset, size, 'APK_AXML_CHUNK_BOUNDS');
  return { type, headerSize, size };
}

function readLength8(bytes: Uint8Array, offset: number): { readonly length: number; readonly next: number } {
  requireRange(bytes, offset, 1, 'APK_AXML_STRING_TRUNCATED');
  const first = bytes[offset] ?? 0;
  if ((first & 0x80) === 0) return { length: first, next: offset + 1 };
  requireRange(bytes, offset, 2, 'APK_AXML_STRING_TRUNCATED');
  return {
    length: ((first & 0x7f) << 8) | (bytes[offset + 1] ?? 0),
    next: offset + 2,
  };
}

function readLength16(bytes: Uint8Array, offset: number): { readonly length: number; readonly next: number } {
  const first = readU16(bytes, offset, 'APK_AXML_STRING_TRUNCATED');
  if ((first & 0x8000) === 0) return { length: first, next: offset + 2 };
  const second = readU16(bytes, offset + 2, 'APK_AXML_STRING_TRUNCATED');
  return {
    length: ((first & 0x7fff) << 16) | second,
    next: offset + 4,
  };
}

function decodeUtf8(bytes: Uint8Array, offset: number, length: number): string {
  requireRange(bytes, offset, length + 1, 'APK_AXML_STRING_TRUNCATED');
  if (bytes[offset + length] !== 0) {
    fail('APK_AXML_STRING_TERMINATOR', 'UTF-8 string is missing its terminator.');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + length));
  } catch {
    return fail('APK_AXML_STRING_ENCODING', 'UTF-8 string is invalid.');
  }
}

function decodeUtf16(bytes: Uint8Array, offset: number, length: number): string {
  const byteLength = length * 2;
  requireRange(bytes, offset, byteLength + 2, 'APK_AXML_STRING_TRUNCATED');
  if (readU16(bytes, offset + byteLength, 'APK_AXML_STRING_TERMINATOR') !== 0) {
    fail('APK_AXML_STRING_TERMINATOR', 'UTF-16 string is missing its terminator.');
  }
  const chunks: string[] = [];
  for (let cursor = 0; cursor < length; cursor += 4096) {
    const end = Math.min(length, cursor + 4096);
    const units: number[] = [];
    for (let index = cursor; index < end; index += 1) {
      units.push(readU16(bytes, offset + index * 2, 'APK_AXML_STRING_TRUNCATED'));
    }
    chunks.push(String.fromCharCode(...units));
  }
  return chunks.join('');
}

function parseStringPool(
  bytes: Uint8Array,
  offset: number,
  size: number,
  headerSize: number,
): StringPool {
  if (headerSize < 28 || size < headerSize) {
    fail('APK_AXML_STRING_POOL', 'String-pool header is invalid.');
  }
  const count = readU32(bytes, offset + 8, 'APK_AXML_STRING_POOL');
  const styleCount = readU32(bytes, offset + 12, 'APK_AXML_STRING_POOL');
  const flags = readU32(bytes, offset + 16, 'APK_AXML_STRING_POOL');
  const stringsStart = readU32(bytes, offset + 20, 'APK_AXML_STRING_POOL');
  if (stringsStart > size) {
    fail('APK_AXML_STRING_POOL', 'String-pool string-data offset is invalid.');
  }

  const offsetsStart = offset + headerSize;
  const offsetsLength = count * 4;
  requireRange(bytes, offsetsStart, offsetsLength, 'APK_AXML_STRING_POOL');
  const stringsOffset = offset + stringsStart;
  const stringsLength = size - stringsStart;
  requireRange(bytes, stringsOffset, stringsLength, 'APK_AXML_STRING_POOL');

  if (styleCount > 0) {
    const stylesStart = readU32(bytes, offset + 24, 'APK_AXML_STRING_POOL');
    if (stylesStart !== 0) {
      if (stylesStart > size) {
        fail('APK_AXML_STRING_POOL', 'String-pool style-data offset is invalid.');
      }
      requireRange(bytes, offset + stylesStart, size - stylesStart, 'APK_AXML_STRING_POOL');
    }
  }

  const strings: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const relative = readU32(bytes, offsetsStart + index * 4, 'APK_AXML_STRING_POOL');
    if (relative >= stringsLength) {
      fail('APK_AXML_STRING_INDEX', 'String-pool offset is outside the chunk.');
    }
    const stringOffset = stringsOffset + relative;
    if ((flags & UTF8_FLAG) !== 0) {
      const charLength = readLength8(bytes, stringOffset);
      const byteLength = readLength8(bytes, charLength.next);
      strings.push(decodeUtf8(bytes, byteLength.next, byteLength.length));
    } else {
      const stringLength = readLength16(bytes, stringOffset);
      strings.push(decodeUtf16(bytes, stringLength.next, stringLength.length));
    }
  }
  return { strings };
}

function stringAt(pool: StringPool, index: number): string {
  if (index === NO_INDEX) return '';
  const value = pool.strings[index];
  if (value === undefined) fail('APK_AXML_STRING_INDEX', 'String-pool index is invalid.');
  return value;
}

function optionalString(pool: StringPool, index: number): string | undefined {
  return index === NO_INDEX ? undefined : stringAt(pool, index);
}

function parseAttribute(
  bytes: Uint8Array,
  pool: StringPool,
  offset: number,
  attributeSize: number,
): Attribute {
  if (attributeSize < 20) {
    fail('APK_AXML_ATTRIBUTE', 'Android attribute size is too small.');
  }
  const namespace = optionalString(pool, readU32(bytes, offset));
  const name = stringAt(pool, readU32(bytes, offset + 4));
  const valueType = bytes[offset + 15];
  const valueData = readU32(bytes, offset + 16);
  if (readU16(bytes, offset + 12) !== 8 || bytes[offset + 14] !== 0 || valueType === undefined) {
    fail('APK_AXML_ATTRIBUTE', 'Android attribute typed-value header is invalid.');
  }
  const value = valueType === VALUE_STRING ? stringAt(pool, valueData) : undefined;
  return {
    namespace,
    name,
    type: valueType,
    data: valueData,
    value,
  };
}

function parseStartElement(
  bytes: Uint8Array,
  pool: StringPool,
  offset: number,
  size: number,
): Element {
  if (size < 36) {
    fail('APK_AXML_ELEMENT', 'Start-element chunk is too small.');
  }
  const name = stringAt(pool, readU32(bytes, offset + 20));
  const attributeStart = readU16(bytes, offset + 24);
  const attributeSize = readU16(bytes, offset + 26);
  const attributeCount = readU16(bytes, offset + 28);
  if (attributeStart < 20 || attributeSize < 20) {
    fail('APK_AXML_ELEMENT', 'Start-element attribute metadata is invalid.');
  }
  const attributesOffset = offset + 16 + attributeStart;
  const attributesLength = attributeCount * attributeSize;
  requireRange(bytes, attributesOffset, attributesLength, 'APK_AXML_ATTRIBUTE');
  if (attributesOffset + attributesLength > offset + size) {
    fail('APK_AXML_ATTRIBUTE', 'Start-element attributes exceed their chunk.');
  }
  const attributes: Attribute[] = [];
  for (let index = 0; index < attributeCount; index += 1) {
    attributes.push(parseAttribute(bytes, pool, attributesOffset + index * attributeSize, attributeSize));
  }
  return { name, attributes };
}

function findAttribute(
  element: Element,
  namespace: string | undefined,
  name: string,
): Attribute | undefined {
  return element.attributes.find(
    (attribute) =>
      attribute.name === name &&
      (namespace === undefined ? attribute.namespace === undefined : attribute.namespace === namespace),
  );
}

function readIntegerAttribute(attribute: Attribute | undefined): number | undefined {
  if (attribute === undefined) return undefined;
  if (attribute.type !== VALUE_INT_DEC && attribute.type !== VALUE_INT_HEX) return undefined;
  return attribute.data;
}

/**
 * Parses Android binary XML and extracts manifest and uses-sdk metadata.
 */
export function parseBinaryXml(bytes: Uint8Array): ParsedManifest {
  if (bytes.byteLength > MAX_MANIFEST_BYTES) {
    fail('APK_AXML_LIMIT', 'Android manifest exceeds 8 MiB.');
  }

  const header = chunkBounds(bytes, 0);
  if (header.type !== XML_HEADER || header.headerSize !== 8 || header.size !== 8) {
    fail('APK_AXML_HEADER', 'Android binary XML header is invalid.');
  }

  let cursor = header.size;
  const stringChunk = chunkBounds(bytes, cursor);
  if (stringChunk.type !== STRING_POOL) {
    fail('APK_AXML_STRING_POOL', 'Android binary XML string pool is missing.');
  }
  const pool = parseStringPool(bytes, cursor, stringChunk.size, stringChunk.headerSize);
  cursor += stringChunk.size;

  let root: Element | undefined;
  let rootDepth = 0;
  let rootClosed = false;
  let depth = 0;
  let manifest: ParsedManifest | undefined;
  const stack: string[] = [];

  while (cursor < bytes.byteLength) {
    const chunk = chunkBounds(bytes, cursor);
    switch (chunk.type) {
      case RESOURCE_MAP:
      case START_NAMESPACE:
      case END_NAMESPACE:
        break;
      case START_ELEMENT: {
        if (rootClosed) fail('APK_AXML_ROOT', 'Android binary XML contains more than one root element.');
        const element = parseStartElement(bytes, pool, cursor, chunk.size);
        depth += 1;
        stack.push(element.name);
        if (root === undefined) {
          if (element.name !== 'manifest') {
            fail('APK_AXML_ROOT', 'Android binary XML root element is not manifest.');
          }
          root = element;
          rootDepth = depth;
          const packageAttribute = findAttribute(element, undefined, 'package');
          const packageName = packageAttribute?.value;
          if (packageName === undefined || packageName.length === 0) {
            fail('APK_AXML_MANIFEST', 'Android manifest package attribute is missing.');
          }
          const versionCode = readIntegerAttribute(
            findAttribute(element, ANDROID_NS, 'versionCode'),
          );
          const versionNameAttribute = findAttribute(element, ANDROID_NS, 'versionName');
          const versionName =
            versionNameAttribute?.type === VALUE_STRING ? versionNameAttribute.value : undefined;
          manifest = {
            packageName,
            ...(versionCode === undefined ? {} : { versionCode }),
            ...(versionName === undefined ? {} : { versionName }),
          };
        } else if (
          element.name === 'uses-sdk' &&
          depth === rootDepth + 1 &&
          manifest !== undefined
        ) {
          const minSdk = readIntegerAttribute(
            findAttribute(element, ANDROID_NS, 'minSdkVersion'),
          );
          const targetSdk = readIntegerAttribute(
            findAttribute(element, ANDROID_NS, 'targetSdkVersion'),
          );
          manifest = {
            ...manifest,
            ...(minSdk === undefined ? {} : { minSdk }),
            ...(targetSdk === undefined ? {} : { targetSdk }),
          };
        }
        break;
      }
      case END_ELEMENT: {
        requireRange(bytes, cursor, 24, 'APK_AXML_ELEMENT');
        const name = stringAt(pool, readU32(bytes, cursor + 20));
        const open = stack.pop();
        if (open !== name) {
          fail('APK_AXML_ELEMENT', 'Android binary XML element nesting is invalid.');
        }
        depth -= 1;
        if (root !== undefined && depth === 0) rootClosed = true;
        break;
      }
      default:
        break;
    }
    cursor += chunk.size;
  }

  if (root === undefined || manifest === undefined || depth !== 0 || stack.length !== 0) {
    fail('APK_AXML_MANIFEST', 'Android binary XML does not contain a complete manifest.');
  }
  return manifest;
}
