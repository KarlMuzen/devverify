import { sha256Hex } from '../fingerprint.js';
import { ApkParseError, type RandomAccessSource } from './source.js';
import { findEocd } from './zip.js';

export const APK_SIG_BLOCK_MAGIC = new TextEncoder().encode('APK Sig Block 42');
export const V2_BLOCK_ID = 0x7109871a;
export const V3_BLOCK_ID = 0xf05368c0;
export const V31_BLOCK_ID = 0x1b93ad61;
export const PROOF_OF_ROTATION_ATTRIBUTE_ID = 0x3ba06f8c;
export const MAX_SIGNING_BLOCK_BYTES = 64 * 1024 * 1024;
export const MAX_SIGNERS = 32;
export const MAX_CERTIFICATES = 32;
export const MAX_CERTIFICATE_BYTES = 1 * 1024 * 1024;

export type ApkSignerScheme = 'v2' | 'v3' | 'v3.1';

export interface ApkSigner {
  readonly scheme: ApkSignerScheme;
  readonly certificates: Uint8Array[];
  readonly fingerprint: string;
  readonly minSdk?: number;
  readonly maxSdk?: number;
  readonly hasRotationLineage: boolean;
}

interface ParsedSigner {
  readonly certificates: Uint8Array[];
  readonly minSdk?: number;
  readonly maxSdk?: number;
  readonly hasRotationLineage: boolean;
}

class Cursor {
  public position = 0;

  public constructor(public readonly bytes: Uint8Array) {}

  public get remaining(): number {
    return this.bytes.byteLength - this.position;
  }

  public u32(): number {
    this.require(4);
    const view = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset,
      this.bytes.byteLength,
    );
    const value = view.getUint32(this.position, true);
    this.position += 4;
    return value;
  }

  public bytesOf(length: number, code = 'APK_SIGNING_BLOCK_BOUNDS'): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) {
      throw new ApkParseError(code, 'APK signing structure is truncated or out of bounds.');
    }
    const result = this.bytes.subarray(this.position, this.position + length);
    this.position += length;
    return result;
  }

  public lp(code = 'APK_SIGNING_BLOCK_FIELD_INVALID'): Uint8Array {
    const length = this.u32();
    if (length > this.remaining) {
      throw new ApkParseError(code, 'Length-prefixed APK field exceeds its container.');
    }
    return this.bytesOf(length, code);
  }

  private require(length: number): void {
    if (this.remaining < length) {
      throw new ApkParseError(
        'APK_SIGNING_BLOCK_BOUNDS',
        'APK signing structure is truncated or out of bounds.',
      );
    }
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

function readU64(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || bytes.byteLength - offset < 8) {
    throw new ApkParseError('APK_SIGNING_BLOCK_BOUNDS', 'APK signing block is truncated.');
  }
  const value = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ApkParseError(
      'APK_SIGNING_BLOCK_U64_OVERFLOW',
      'APK signing block size exceeds the supported range.',
    );
  }
  return Number(value);
}

function readId(bytes: Uint8Array, offset: number): number {
  if (bytes.byteLength - offset < 4) {
    throw new ApkParseError('APK_SIGNING_BLOCK_BOUNDS', 'Signing block ID is truncated.');
  }
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function parseDigestSequence(bytes: Uint8Array): void {
  const cursor = new Cursor(bytes);

  while (cursor.remaining > 0) {
    const digest = cursor.lp('APK_V2_DIGEST_INVALID');
    if (digest.byteLength < 4) {
      throw new ApkParseError('APK_V2_DIGEST_INVALID', 'APK digest record is too short.');
    }
    const digestCursor = new Cursor(digest);
    digestCursor.u32();
    void digestCursor.lp('APK_V2_DIGEST_INVALID');
    if (digestCursor.remaining !== 0) {
      throw new ApkParseError('APK_V2_DIGEST_INVALID', 'APK digest record has trailing bytes.');
    }
  }
}

function parseSignatureSequence(bytes: Uint8Array): void {
  const cursor = new Cursor(bytes);

  while (cursor.remaining > 0) {
    const signature = cursor.lp('APK_SIGNATURE_INVALID');
    if (signature.byteLength < 4) {
      throw new ApkParseError('APK_SIGNATURE_INVALID', 'APK signature record is too short.');
    }
    const signatureCursor = new Cursor(signature);
    signatureCursor.u32();
    void signatureCursor.lp('APK_SIGNATURE_INVALID');
    if (signatureCursor.remaining !== 0) {
      throw new ApkParseError('APK_SIGNATURE_INVALID', 'APK signature record has trailing bytes.');
    }
  }
}

function parseCertificates(bytes: Uint8Array): Uint8Array[] {
  const cursor = new Cursor(bytes);
  const certificates: Uint8Array[] = [];

  while (cursor.remaining > 0) {
    if (certificates.length >= MAX_CERTIFICATES) {
      throw new ApkParseError('APK_CERTIFICATE_LIMIT', 'APK signer contains too many certificates.');
    }
    const certificate = cursor.lp('APK_CERTIFICATE_INVALID');
    if (certificate.byteLength === 0 || certificate.byteLength > MAX_CERTIFICATE_BYTES) {
      throw new ApkParseError('APK_CERTIFICATE_INVALID', 'APK certificate has an invalid size.');
    }
    certificates.push(certificate);
  }

  return certificates;
}

function parseAdditionalAttributes(bytes: Uint8Array): boolean {
  const cursor = new Cursor(bytes);

  while (cursor.remaining > 0) {
    const attribute = cursor.lp('APK_ATTRIBUTE_INVALID');
    if (attribute.byteLength < 4) {
      throw new ApkParseError('APK_ATTRIBUTE_INVALID', 'APK additional attribute is too short.');
    }
    const id = readId(attribute, 0);
    if (id === PROOF_OF_ROTATION_ATTRIBUTE_ID) {
      return true;
    }
  }

  return false;
}

function parseSignedData(
  bytes: Uint8Array,
  scheme: ApkSignerScheme,
): ParsedSigner {
  const cursor = new Cursor(bytes);
  parseDigestSequence(cursor.lp('APK_SIGNED_DATA_INVALID'));
  const certificates = parseCertificates(cursor.lp('APK_CERTIFICATE_INVALID'));

  if (certificates.length === 0) {
    throw new ApkParseError('APK_CERTIFICATE_MISSING', 'APK signer has no certificates.');
  }

  let minSdk: number | undefined;
  let maxSdk: number | undefined;
  if (scheme !== 'v2') {
    minSdk = cursor.u32();
    maxSdk = cursor.u32();
  }

  const hasRotationLineage = parseAdditionalAttributes(
    cursor.lp('APK_ATTRIBUTE_INVALID'),
  );

  if (cursor.remaining !== 0) {
    throw new ApkParseError('APK_SIGNED_DATA_TRAILING', 'APK signed data contains trailing bytes.');
  }

  return {
    certificates,
    ...(minSdk === undefined ? {} : { minSdk }),
    ...(maxSdk === undefined ? {} : { maxSdk }),
    hasRotationLineage,
  };
}

function parseSigner(bytes: Uint8Array, scheme: ApkSignerScheme): ParsedSigner {
  const cursor = new Cursor(bytes);
  const signedData = cursor.lp('APK_SIGNER_INVALID');
  const parsed = parseSignedData(signedData, scheme);

  if (scheme !== 'v2') {
    const minSdk = cursor.u32();
    const maxSdk = cursor.u32();
    if (minSdk !== parsed.minSdk || maxSdk !== parsed.maxSdk) {
      throw new ApkParseError(
        'APK_SDK_RANGE_MISMATCH',
        'APK signer SDK range does not match its signed data.',
      );
    }
  }

  parseSignatureSequence(cursor.lp('APK_SIGNATURES_INVALID'));
  void cursor.lp('APK_PUBLIC_KEY_INVALID');

  if (cursor.remaining !== 0) {
    throw new ApkParseError('APK_SIGNER_TRAILING', 'APK signer contains trailing bytes.');
  }

  return parsed;
}

function parseSchemeValue(
  value: Uint8Array,
  scheme: ApkSignerScheme,
): Promise<ApkSigner[]> {
  const cursor = new Cursor(value);
  const signersContainer = cursor.lp('APK_SIGNERS_INVALID');
  if (cursor.remaining !== 0) {
    throw new ApkParseError('APK_SIGNERS_TRAILING', 'APK signer block contains trailing bytes.');
  }

  const signers = new Cursor(signersContainer);
  const result: ApkSigner[] = [];

  while (signers.remaining > 0) {
    if (result.length >= MAX_SIGNERS) {
      throw new ApkParseError('APK_SIGNER_LIMIT', 'APK signing block contains too many signers.');
    }

    const parsed = parseSigner(
      signers.lp('APK_SIGNER_INVALID'),
      scheme,
    );
    const [certificate] = parsed.certificates;
    if (certificate === undefined) {
      throw new ApkParseError('APK_CERTIFICATE_MISSING', 'APK signer has no signer certificate.');
    }

    result.push({
      scheme,
      certificates: parsed.certificates,
      fingerprint: '',
      ...(parsed.minSdk === undefined ? {} : { minSdk: parsed.minSdk }),
      ...(parsed.maxSdk === undefined ? {} : { maxSdk: parsed.maxSdk }),
      hasRotationLineage: parsed.hasRotationLineage,
    });

    void certificate;
  }

  return finalizeFingerprints(result);
}

async function finalizeFingerprints(signers: ApkSigner[]): Promise<ApkSigner[]> {
  const result: ApkSigner[] = [];

  for (const signer of signers) {
    const [certificate] = signer.certificates;
    if (certificate === undefined) {
      throw new ApkParseError('APK_CERTIFICATE_MISSING', 'APK signer has no signer certificate.');
    }
    result.push({
      ...signer,
      fingerprint: await sha256Hex(certificate),
    });
  }

  return result;
}

function schemeForId(id: number): ApkSignerScheme | undefined {
  switch (id) {
    case V2_BLOCK_ID:
      return 'v2';
    case V3_BLOCK_ID:
      return 'v3';
    case V31_BLOCK_ID:
      return 'v3.1';
    default:
      return undefined;
  }
}

/**
 * Reads and validates the APK signing block immediately before the central directory.
 * The parser extracts declared X.509 certificates but does not verify signatures or digests.
 */
export async function readSigningBlock(
  source: RandomAccessSource,
  centralDirectoryOffset: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(centralDirectoryOffset) || centralDirectoryOffset < 24) {
    throw new ApkParseError('APK_SIGNING_BLOCK_MISSING', 'APK signing block cannot precede the central directory.');
  }

  const footer = await source.read(centralDirectoryOffset - 24, 24);
  if (!sameBytes(footer.subarray(8), APK_SIG_BLOCK_MAGIC)) {
    throw new ApkParseError('APK_SIGNING_BLOCK_MAGIC', 'APK signing block magic is missing.');
  }

  const size = readU64(footer, 0);
  const totalSize = size + 8;
  if (size < 24 || totalSize > MAX_SIGNING_BLOCK_BYTES || totalSize > centralDirectoryOffset) {
    throw new ApkParseError('APK_SIGNING_BLOCK_SIZE', 'APK signing block size is invalid.');
  }

  const secondSize = size;
  const start = centralDirectoryOffset - totalSize;
  const block = await source.read(start, totalSize);

  if (readU64(block, 0) !== secondSize) {
    throw new ApkParseError('APK_SIGNING_BLOCK_SIZE_MISMATCH', 'APK signing block size fields differ.');
  }
  if (!sameBytes(block.subarray(block.byteLength - 16), APK_SIG_BLOCK_MAGIC)) {
    throw new ApkParseError('APK_SIGNING_BLOCK_MAGIC', 'APK signing block magic is missing.');
  }

  return block;
}

/**
 * Extracts all recognized v2, v3, and v3.1 signer certificates from an APK.
 */
export async function extractApkSigners(source: RandomAccessSource): Promise<ApkSigner[]> {
  const eocd = await findEocd(source);
  const block = await readSigningBlock(source, eocd.centralDirectoryOffset);
  const pairsEnd = block.byteLength - 24;
  const cursor = new Cursor(block.subarray(8, pairsEnd));
  const result: ApkSigner[] = [];

  while (cursor.remaining > 0) {
    const pair = cursor.lp('APK_SIGNING_PAIR_INVALID');
    if (pair.byteLength < 4) {
      throw new ApkParseError('APK_SIGNING_PAIR_INVALID', 'Signing-block ID/value pair is too short.');
    }

    const id = readId(pair, 0);
    const scheme = schemeForId(id);
    if (scheme === undefined) {
      continue;
    }

    const parsed = await parseSchemeValue(pair.subarray(4), scheme);
    result.push(...parsed);

    if (result.length > MAX_SIGNERS) {
      throw new ApkParseError('APK_SIGNER_LIMIT', 'APK signing block contains too many signers.');
    }
  }

  return result;
}

export async function extractApkSignersOrEmpty(
  source: RandomAccessSource,
): Promise<ApkSigner[]> {
  try {
    return await extractApkSigners(source);
  } catch (error) {
    if (error instanceof ApkParseError && error.code === 'APK_SIGNING_BLOCK_MISSING') {
      return [];
    }
    throw error;
  }
}
