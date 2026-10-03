import { ApkParseError, type RandomAccessSource } from './source.js';

export const EOCD_SIGNATURE = 0x06054b50;
export const ZIP64_EOCD_SIGNATURE = 0x06064b50;
export const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
export const MAX_EOCD_SCAN_BYTES = 65_557;
export const MAX_ZIP64_EOCD_BYTES = 1 * 1024 * 1024;
export const MAX_CENTRAL_DIRECTORY_ENTRIES = 100_000;

export interface EocdInfo {
  readonly centralDirectoryOffset: number;
  readonly centralDirectorySize: number;
  readonly totalEntries: number;
  readonly eocdOffset: number;
  readonly zip64: boolean;
}

export function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function checkedU64(view: DataView, offset: number, code: string): number {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ApkParseError(code, 'ZIP64 value exceeds JavaScript safe integer range.');
  }
  return Number(value);
}

export function checkedAdd(left: number, right: number, code: string): number {
  if (
    !Number.isSafeInteger(left) ||
    !Number.isSafeInteger(right) ||
    right > Number.MAX_SAFE_INTEGER - left
  ) {
    throw new ApkParseError(code, 'ZIP numeric value overflows the supported range.');
  }
  return left + right;
}

export function requireRange(bytes: Uint8Array, offset: number, length: number): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > bytes.byteLength ||
    length > bytes.byteLength - offset
  ) {
    throw new ApkParseError('APK_ZIP_BOUNDS', 'ZIP structure is truncated or out of bounds.');
  }
}

export function readU32(bytes: Uint8Array, offset: number): number {
  requireRange(bytes, offset, 4);
  return viewOf(bytes).getUint32(offset, true);
}

export function readU64(bytes: Uint8Array, offset: number): number {
  requireRange(bytes, offset, 8);
  return checkedU64(viewOf(bytes), offset, 'APK_ZIP_U64_OVERFLOW');
}

async function readZip64Eocd(
  source: RandomAccessSource,
  offset: number,
): Promise<{ centralDirectoryOffset: number; centralDirectorySize: number; totalEntries: number }> {
  const header = await source.read(offset, 56);
  if (readU32(header, 0) !== ZIP64_EOCD_SIGNATURE) {
    throw new ApkParseError('APK_ZIP64_EOCD_INVALID', 'ZIP64 EOCD record is missing.');
  }

  const size = readU64(header, 4);
  if (size < 44 || size > MAX_ZIP64_EOCD_BYTES - 12) {
    throw new ApkParseError('APK_ZIP64_EOCD_INVALID', 'ZIP64 EOCD record size is invalid.');
  }

  const recordLength = checkedAdd(12, size, 'APK_ZIP64_EOCD_OVERFLOW');
  const record = recordLength === 56 ? header : await source.read(offset, recordLength);
  const view = viewOf(record);
  const totalEntries = view.getBigUint64(32, true);

  if (totalEntries > BigInt(MAX_CENTRAL_DIRECTORY_ENTRIES)) {
    throw new ApkParseError('APK_ZIP_ENTRY_LIMIT', 'ZIP contains too many central directory entries.');
  }

  return {
    totalEntries: Number(totalEntries),
    centralDirectorySize: checkedU64(view, 40, 'APK_ZIP64_CD_OVERFLOW'),
    centralDirectoryOffset: checkedU64(view, 48, 'APK_ZIP64_CD_OVERFLOW'),
  };
}

async function resolveZip64(
  source: RandomAccessSource,
  eocdOffset: number,
): Promise<{ centralDirectoryOffset: number; centralDirectorySize: number; totalEntries: number }> {
  if (eocdOffset < 20) {
    throw new ApkParseError('APK_ZIP64_LOCATOR_MISSING', 'ZIP64 locator is missing.');
  }

  const locator = await source.read(eocdOffset - 20, 20);
  if (readU32(locator, 0) !== ZIP64_LOCATOR_SIGNATURE) {
    throw new ApkParseError('APK_ZIP64_LOCATOR_MISSING', 'ZIP64 locator signature is missing.');
  }
  if (readU32(locator, 4) !== 0 || readU32(locator, 16) !== 1) {
    throw new ApkParseError('APK_ZIP64_MULTI_DISK', 'Multi-disk ZIP archives are not supported.');
  }

  return readZip64Eocd(source, readU64(locator, 8));
}

/**
 * Finds and validates the final ZIP End of Central Directory record with one tail read.
 */
export async function findEocd(source: RandomAccessSource): Promise<EocdInfo> {
  const scanLength = Math.min(source.size, MAX_EOCD_SCAN_BYTES);
  if (scanLength < 22) {
    throw new ApkParseError('APK_EOCD_NOT_FOUND', 'ZIP End of Central Directory record is missing.');
  }

  const scanOffset = source.size - scanLength;
  const tail = await source.read(scanOffset, scanLength);
  const view = viewOf(tail);

  for (let relative = tail.byteLength - 22; relative >= 0; relative -= 1) {
    if (view.getUint32(relative, true) !== EOCD_SIGNATURE) {
      continue;
    }

    const commentLength = view.getUint16(relative + 20, true);
    if (commentLength !== tail.byteLength - relative - 22) {
      continue;
    }

    const entries16 = view.getUint16(relative + 10, true);
    const size32 = view.getUint32(relative + 12, true);
    const offset32 = view.getUint32(relative + 16, true);
    const needsZip64 = entries16 === 0xffff || size32 === 0xffffffff || offset32 === 0xffffffff;
    const eocdOffset = scanOffset + relative;

    if (needsZip64) {
      const zip64 = await resolveZip64(source, eocdOffset);
      const end = checkedAdd(zip64.centralDirectoryOffset, zip64.centralDirectorySize, 'APK_ZIP_CD_OVERFLOW');
      if (end > source.size) {
        throw new ApkParseError('APK_ZIP_CD_OUT_OF_BOUNDS', 'ZIP64 central directory is outside the file.');
      }
      return { ...zip64, eocdOffset, zip64: true };
    }

    const end = checkedAdd(offset32, size32, 'APK_ZIP_CD_OVERFLOW');
    if (end > source.size) {
      throw new ApkParseError('APK_ZIP_CD_OUT_OF_BOUNDS', 'Central directory is outside the file.');
    }
    return {
      centralDirectoryOffset: offset32,
      centralDirectorySize: size32,
      totalEntries: entries16,
      eocdOffset,
      zip64: false,
    };
  }

  throw new ApkParseError('APK_EOCD_NOT_FOUND', 'ZIP End of Central Directory record is missing.');
}
