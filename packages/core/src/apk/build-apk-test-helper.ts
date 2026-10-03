import type {
  ApkSignerScheme,
  VirtualPatch,
} from './index.js';

export interface TestZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
  readonly method?: 0 | 8;
}

export interface TestSigner {
  readonly scheme: ApkSignerScheme;
  readonly certificate: Uint8Array;
  readonly hasRotationLineage?: boolean;
  readonly minSdk?: number;
  readonly maxSdk?: number;
}

function u16(value: number): Uint8Array {
  const result = new Uint8Array(2);
  new DataView(result.buffer).setUint16(0, value & 0xffff, true);
  return result;
}

function u32(value: number): Uint8Array {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value >>> 0, true);
  return result;
}

function u64(value: number): Uint8Array {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigUint64(0, BigInt(value), true);
  return result;
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

function lp32(value: Uint8Array): Uint8Array {
  return concat(u32(value.byteLength), value);
}

function lp64(value: Uint8Array): Uint8Array {
  return concat(u64(value.byteLength), value);
}

function signingSequence(parts: readonly Uint8Array[]): Uint8Array {
  return concat(...parts.map(lp32));
}

function signingPair(id: number, value: Uint8Array): Uint8Array {
  const payload = concat(u32(id), value);
  return lp64(payload);
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'function') {
    throw new Error('CompressionStream is unavailable.');
  }
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function buildSignedData(signer: TestSigner): Uint8Array {
  const digest = concat(u32(1), lp32(new Uint8Array([1, 2, 3])));
  const certs = lp32(lp32(signer.certificate));
  const sdk =
    signer.scheme === 'v2'
      ? new Uint8Array()
      : concat(u32(signer.minSdk ?? 21), u32(signer.maxSdk ?? 35));
  const attributes = signer.hasRotationLineage
    ? lp32(concat(
        u32(0x3ba06f8c),
        new Uint8Array([1, 2, 3, 4]),
      ))
    : lp32(new Uint8Array());
  return concat(lp32(digest), certs, sdk, attributes);
}

function buildSigner(signer: TestSigner): Uint8Array {
  const signedData = buildSignedData(signer);
  const signature = concat(u32(0x01020304), lp32(new Uint8Array([9, 8, 7])));
  const signatures = lp32(signature);
  const publicKey = lp32(new Uint8Array([4, 5, 6]));
  return concat(
    lp32(signedData),
    ...(signer.scheme === 'v2'
      ? []
      : [u32(signer.minSdk ?? 21), u32(signer.maxSdk ?? 35)]),
    lp32(signatures),
    lp32(publicKey),
  );
}

function schemeBlockId(scheme: ApkSignerScheme): number {
  switch (scheme) {
    case 'v2':
      return 0x7109871a;
    case 'v3':
      return 0xf05368c0;
    case 'v3.1':
      return 0x1b93ad61;
  }
}

export function buildSigningBlock(signers: readonly TestSigner[]): Uint8Array {
  const grouped = new Map<ApkSignerScheme, Uint8Array[]>();

  for (const signer of signers) {
    const current = grouped.get(signer.scheme) ?? [];
    current.push(buildSigner(signer));
    grouped.set(signer.scheme, current);
  }

  const pairs = [...grouped.entries()].map(([scheme, schemeSigners]) =>
    signingPair(schemeBlockId(scheme), lp32(signingSequence(schemeSigners))),
  );
  const magic = new TextEncoder().encode('APK Sig Block 42');
  const size = pairs.reduce((sum, pair) => sum + pair.byteLength, 24);
  return concat(u64(size), ...pairs, u64(size), magic);
}

export async function buildApk(options: {
  readonly entries: readonly TestZipEntry[];
  readonly signers?: readonly TestSigner[];
  readonly zip64?: boolean;
  readonly comment?: Uint8Array;
}): Promise<Uint8Array> {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of options.entries) {
    const method = entry.method ?? 0;
    const storedData =
      method === 8 ? await deflateRaw(entry.data) : new Uint8Array(entry.data);
    const name = new TextEncoder().encode(entry.name);
    const local = concat(
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(0),
      u32(storedData.byteLength),
      u32(entry.data.byteLength),
      u16(name.byteLength),
      u16(0),
      name,
      storedData,
    );
    localParts.push(local);

    const zip64 = options.zip64 === true;
    const extra = zip64
      ? concat(
          u32(0x0001 | (0x0001 << 16)),
          u64(entry.data.byteLength),
          u64(storedData.byteLength),
          u64(offset),
        )
      : new Uint8Array();
    const central = concat(
      u32(0x02014b50),
      u16(45),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(0),
      u32(zip64 ? 0xffffffff : storedData.byteLength),
      u32(zip64 ? 0xffffffff : entry.data.byteLength),
      u16(name.byteLength),
      u16(extra.byteLength),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(zip64 ? 0xffffffff : offset),
      name,
      extra,
    );
    centralParts.push(central);
    offset += local.byteLength;
  }

  const localData = concat(...localParts);
  const centralDirectory = concat(...centralParts);
  const signingBlock = options.signers && options.signers.length > 0
    ? buildSigningBlock(options.signers)
    : new Uint8Array();
  const centralOffset = localData.byteLength + signingBlock.byteLength;
  const comment = options.comment ?? new Uint8Array();

  let suffix: Uint8Array;
  if (options.zip64 === true) {
    const zip64Offset = centralOffset + centralDirectory.byteLength;
    const zip64Eocd = concat(
      u32(0x06064b50),
      u64(44),
      new Uint8Array(4),
      new Uint8Array(4),
      u32(0),
      u32(0),
      u64(options.entries.length),
      u64(options.entries.length),
      u64(centralDirectory.byteLength),
      u64(centralOffset),
    );
    const locator = concat(
      u32(0x07064b50),
      u32(0),
      u64(zip64Offset),
      u32(1),
    );
    const eocd = concat(
      u32(0x06054b50),
      new Uint8Array(4),
      new Uint8Array(2),
      new Uint8Array(2),
      new Uint8Array(4),
      new Uint8Array(4),
      new Uint8Array(2),
      comment,
    );
    suffix = concat(zip64Eocd, locator, eocd);
  } else {
    const eocd = concat(
      u32(0x06054b50),
      new Uint8Array(4),
      new Uint8Array(2),
      new Uint8Array(2),
      u16(options.entries.length),
      u16(options.entries.length),
      u32(centralDirectory.byteLength),
      u32(centralOffset),
      new Uint8Array([comment.byteLength & 0xff, comment.byteLength >>> 8]),
      comment,
    );
    suffix = eocd;
  }

  return concat(localData, signingBlock, centralDirectory, suffix);
}

export function patchEndOfCentralDirectory(
  apk: Uint8Array,
  patches: readonly VirtualPatch[],
): { readonly size: number; readonly patches: VirtualPatch[] } {
  const merged = [...patches];
  const scan = Math.min(apk.byteLength, 65_557);
  merged.push({
    offset: apk.byteLength - scan,
    data: apk.subarray(apk.byteLength - scan),
  });
  return {
    size: apk.byteLength,
    patches: merged,
  };
}
