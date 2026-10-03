import type { RandomAccessSource } from './source.js';
import { ApkParseError } from './source.js';
import { findEocd } from './eocd.js';
import { parseSchemeValue } from './scheme-parser.js';
import { Cursor, readId } from './signing-cursor.js';
import { MAX_SIGNERS } from './signing-limits.js';
import {
  PROOF_OF_ROTATION_ATTRIBUTE_ID,
  V2_BLOCK_ID,
  V31_BLOCK_ID,
  V3_BLOCK_ID,
} from './signing-constants.js';
import type { ApkSigner as ApkSignerType, ApkSignerScheme } from './signing-block-types.js';

export const APK_SIG_BLOCK_MAGIC = new TextEncoder().encode('APK Sig Block 42');
export {
  MAX_CERTIFICATE_BYTES,
  MAX_CERTIFICATES,
  MAX_SIGNERS,
  MAX_SIGNING_BLOCK_BYTES,
} from './signing-limits.js';
export {
  PROOF_OF_ROTATION_ATTRIBUTE_ID,
  V2_BLOCK_ID,
  V31_BLOCK_ID,
  V3_BLOCK_ID,
} from './signing-constants.js';
export type { ApkSigner, ApkSignerScheme } from './signing-block-types.js';

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
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
 */
export async function readSigningBlock(
  source: RandomAccessSource,
  centralDirectoryOffset: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(centralDirectoryOffset) || centralDirectoryOffset < 24) {
    throw new ApkParseError(
      'APK_SIGNING_BLOCK_MISSING',
      'APK signing block cannot precede the central directory.',
    );
  }

  const footer = await source.read(centralDirectoryOffset - 24, 24);
  const footerView = new DataView(footer.buffer, footer.byteOffset, footer.byteLength);
  const size = footerView.getBigUint64(0, true);

  if (!sameBytes(footer.subarray(8), APK_SIG_BLOCK_MAGIC)) {
    if (
      size >= 24n &&
      size <= BigInt(MAX_SIGNING_BLOCK_BYTES - 8) &&
      Number(size) + 8 <= centralDirectoryOffset
    ) {
      throw new ApkParseError('APK_SIGNING_BLOCK_MAGIC', 'APK signing block magic is invalid.');
    }
    throw new ApkParseError('APK_SIGNING_BLOCK_MISSING', 'APK signing block is not present.');
  }

  if (size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ApkParseError(
      'APK_SIGNING_BLOCK_U64_OVERFLOW',
      'APK signing block size exceeds the supported range.',
    );
  }

  const sizeNumber = Number(size);
  const totalSize = sizeNumber + 8;
  if (
    sizeNumber < 24 ||
    !Number.isSafeInteger(totalSize) ||
    totalSize > MAX_SIGNING_BLOCK_BYTES ||
    totalSize > centralDirectoryOffset
  ) {
    throw new ApkParseError('APK_SIGNING_BLOCK_SIZE', 'APK signing block size is invalid.');
  }

  const block = await source.read(centralDirectoryOffset - totalSize, totalSize);
  const blockView = new DataView(block.buffer, block.byteOffset, block.byteLength);
  const firstSize = blockView.getBigUint64(0, true);
  const secondSize = blockView.getBigUint64(block.byteLength - 24, true);

  if (firstSize !== secondSize || firstSize !== size) {
    throw new ApkParseError(
      'APK_SIGNING_BLOCK_SIZE_MISMATCH',
      'APK signing block size fields differ.',
    );
  }
  if (!sameBytes(block.subarray(block.byteLength - 16), APK_SIG_BLOCK_MAGIC)) {
    throw new ApkParseError('APK_SIGNING_BLOCK_MAGIC', 'APK signing block magic is invalid.');
  }

  return block;
}

/**
 * Extracts declared signer certificates. It does not verify signatures or digests.
 */
export async function extractApkSigners(source: RandomAccessSource): Promise<ApkSignerType[]> {
  const eocd = await findEocd(source);
  let block: Uint8Array;

  try {
    block = await readSigningBlock(source, eocd.centralDirectoryOffset);
  } catch (error) {
    if (error instanceof ApkParseError && error.code === 'APK_SIGNING_BLOCK_MISSING') {
      return [];
    }
    throw error;
  }

  const cursor = new Cursor(block.subarray(8, block.byteLength - 24));
  const result: ApkSignerType[] = [];

  while (cursor.remaining > 0) {
    const pair = cursor.lp('APK_SIGNING_PAIR_INVALID');
    if (pair.byteLength < 4) {
      throw new ApkParseError(
        'APK_SIGNING_PAIR_INVALID',
        'Signing-block ID/value pair is too short.',
      );
    }

    const scheme = schemeForId(readId(pair));
    if (scheme === undefined) {
      continue;
    }

    result.push(...await parseSchemeValue(pair.subarray(4), scheme));
    if (result.length > MAX_SIGNERS) {
      throw new ApkParseError(
        'APK_SIGNER_LIMIT',
        'APK signing block contains too many signers.',
      );
    }
  }

  return result;
}
