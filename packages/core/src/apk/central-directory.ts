import {
  MAX_CENTRAL_DIRECTORY_ENTRIES,
  checkedAdd,
  findEocd,
  readU64,
  requireRange,
  viewOf,
  type EocdInfo,
  readU32,
} from './eocd.js';
import { ApkParseError, type RandomAccessSource } from './source.js';

export const MAX_CENTRAL_DIRECTORY_BYTES = 64 * 1024 * 1024;
export const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP64_EXTRA_FIELD = 0x0001;

export interface CentralDirectoryEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

function parseZip64Extra(
  extra: Uint8Array,
  needs: { uncompressed: boolean; compressed: boolean; offset: boolean },
): { uncompressedSize?: number; compressedSize?: number; localHeaderOffset?: number } {
  const view = viewOf(extra);
  let cursor = 0;

  while (cursor < extra.byteLength) {
    requireRange(extra, cursor, 4);
    const id = view.getUint16(cursor, true);
    const length = view.getUint16(cursor + 2, true);
    cursor += 4;
    requireRange(extra, cursor, length);

    if (id === ZIP64_EXTRA_FIELD) {
      let valueOffset = cursor;
      const result: {
        uncompressedSize?: number;
        compressedSize?: number;
        localHeaderOffset?: number;
      } = {};

      if (needs.uncompressed) {
        result.uncompressedSize = readU64(extra, valueOffset);
        valueOffset += 8;
      }
      if (needs.compressed) {
        result.compressedSize = readU64(extra, valueOffset);
        valueOffset += 8;
      }
      if (needs.offset) {
        result.localHeaderOffset = readU64(extra, valueOffset);
      }
      return result;
    }

    cursor += length;
  }

  throw new ApkParseError('APK_ZIP64_EXTRA_MISSING', 'Required ZIP64 extra field is missing.');
}

function parseCentralDirectory(bytes: Uint8Array, expectedEntries: number): CentralDirectoryEntry[] {
  const result: CentralDirectoryEntry[] = [];
  let cursor = 0;
  const view = viewOf(bytes);
  const decoder = new TextDecoder();

  while (cursor < bytes.byteLength) {
    if (result.length >= MAX_CENTRAL_DIRECTORY_ENTRIES) {
      throw new ApkParseError('APK_ZIP_ENTRY_LIMIT', 'ZIP contains too many central directory entries.');
    }
    requireRange(bytes, cursor, 46);
    if (readU32(bytes, cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new ApkParseError('APK_CENTRAL_DIRECTORY_INVALID', 'Invalid central directory record.');
    }

    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressed32 = view.getUint32(cursor + 20, true);
    const uncompressed32 = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset32 = view.getUint32(cursor + 42, true);
    const recordLength = 46 + nameLength + extraLength + commentLength;

    requireRange(bytes, cursor, recordLength);

    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const extra = bytes.subarray(
      cursor + 46 + nameLength,
      cursor + 46 + nameLength + extraLength,
    );
    const needs = {
      uncompressed: uncompressed32 === 0xffffffff,
      compressed: compressed32 === 0xffffffff,
      offset: localOffset32 === 0xffffffff,
    };
    const zip64 = needs.uncompressed || needs.compressed || needs.offset
      ? parseZip64Extra(extra, needs)
      : {};

    if (flags & 0x0001) {
      throw new ApkParseError('APK_ZIP_ENCRYPTED', 'Encrypted ZIP entries are not supported.');
    }

    result.push({
      name,
      method,
      compressedSize: zip64.compressedSize ?? compressed32,
      uncompressedSize: zip64.uncompressedSize ?? uncompressed32,
      localHeaderOffset: zip64.localHeaderOffset ?? localOffset32,
    });
    cursor += recordLength;
  }

  if (result.length !== expectedEntries) {
    throw new ApkParseError('APK_CENTRAL_DIRECTORY_COUNT', 'Central directory entry count does not match the EOCD.');
  }
  return result;
}

/**
 * Reads the central directory with exactly one read of its byte range.
 */
export async function readCentralDirectory(
  source: RandomAccessSource,
  eocd?: EocdInfo,
): Promise<CentralDirectoryEntry[]> {
  const info = eocd ?? (await findEocd(source));
  if (info.centralDirectorySize > MAX_CENTRAL_DIRECTORY_BYTES) {
    throw new ApkParseError('APK_CENTRAL_DIRECTORY_LIMIT', 'Central directory exceeds 64 MiB.');
  }

  const end = checkedAdd(info.centralDirectoryOffset, info.centralDirectorySize, 'APK_ZIP_CD_OVERFLOW');
  if (end > source.size) {
    throw new ApkParseError('APK_ZIP_CD_OUT_OF_BOUNDS', 'Central directory is outside the file.');
  }

  const bytes = await source.read(info.centralDirectoryOffset, info.centralDirectorySize);
  return parseCentralDirectory(bytes, info.totalEntries);
}
