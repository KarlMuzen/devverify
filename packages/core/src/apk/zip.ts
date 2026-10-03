import { ApkParseError, type RandomAccessSource } from './source.js';

export const MAX_CENTRAL_DIRECTORY_BYTES = 64 * 1024 * 1024;
export const MAX_INFLATED_ENTRY_BYTES = 64 * 1024 * 1024;

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP64_EXTRA_FIELD = 0x0001;
const MAX_EOCD_SCAN_BYTES = 65_557;
const MAX_ZIP64_EOCD_BYTES = 1 * 1024 * 1024;
const MAX_CENTRAL_DIRECTORY_ENTRIES = 100_000;

export interface EocdInfo {
  readonly centralDirectoryOffset: number;
  readonly centralDirectorySize: number;
  readonly totalEntries: number;
  readonly eocdOffset: number;
  readonly zip64: boolean;
}

export interface CentralDirectoryEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function checkedU64(view: DataView, offset: number, code: string): number {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ApkParseError(code, 'ZIP64 value exceeds JavaScript safe integer range.');
  }
  return Number(value);
}

function checkedAdd(left: number, right: number, code: string): number {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || right > Number.MAX_SAFE_INTEGER - left) {
    throw new ApkParseError(code, 'ZIP numeric value overflows the supported range.');
  }
  return left + right;
}

function requireRange(bytes: Uint8Array, offset: number, length: number): void {
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

function readU32(bytes: Uint8Array, offset: number): number {
  requireRange(bytes, offset, 4);
  return viewOf(bytes).getUint32(offset, true);
}

function readU64(bytes: Uint8Array, offset: number): number {
  requireRange(bytes, offset, 8);
  return checkedU64(viewOf(bytes), offset, 'APK_ZIP_U64_OVERFLOW');
}

function findSignatureBackwards(bytes: Uint8Array, signature: number): number {
  for (let offset = bytes.byteLength - 4; offset >= 0; offset -= 1) {
    if (readU32(bytes, offset) === signature) {
      return offset;
    }
  }
  return -1;
}

async function readZip64Eocd(source: RandomAccessSource, offset: number): Promise<{
  centralDirectoryOffset: number;
  centralDirectorySize: number;
  totalEntries: number;
}> {
  const header = await source.read(offset, 56);
  if (readU32(header, 0) !== ZIP64_EOCD_SIGNATURE) {
    throw new ApkParseError('APK_ZIP64_EOCD_INVALID', 'ZIP64 EOCD record is missing.');
  }

  const size = readU64(header, 4);
  if (size < 44 || size > MAX_ZIP64_EOCD_BYTES - 12) {
    throw new ApkParseError('APK_ZIP64_EOCD_INVALID', 'ZIP64 EOCD record size is invalid.');
  }

  const recordLength = checkedAdd(12, size, 'APK_ZIP64_EOCD_OVERFLOW');
  const record = recordLength === header.byteLength
    ? header
    : await source.read(offset, recordLength);

  const view = viewOf(record);
  const totalEntriesBig = view.getBigUint64(32, true);
  if (totalEntriesBig > BigInt(MAX_CENTRAL_DIRECTORY_ENTRIES)) {
    throw new ApkParseError('APK_ZIP_ENTRY_LIMIT', 'ZIP contains too many central directory entries.');
  }

  return {
    totalEntries: Number(totalEntriesBig),
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

  const zip64Offset = readU64(locator, 8);
  return readZip64Eocd(source, zip64Offset);
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

    const totalEntries16 = view.getUint16(relative + 10, true);
    const centralDirectorySize32 = view.getUint32(relative + 12, true);
    const centralDirectoryOffset32 = view.getUint32(relative + 16, true);
    const sentinel =
      totalEntries16 === 0xffff ||
      centralDirectorySize32 === 0xffffffff ||
      centralDirectoryOffset32 === 0xffffffff;

    const eocdOffset = scanOffset + relative;

    if (sentinel) {
      const zip64 = await resolveZip64(source, eocdOffset);
      const end = checkedAdd(
        zip64.centralDirectoryOffset,
        zip64.centralDirectorySize,
        'APK_ZIP_CD_OVERFLOW',
      );
      if (end > source.size) {
        throw new ApkParseError('APK_ZIP_CD_OUT_OF_BOUNDS', 'ZIP64 central directory is outside the file.');
      }

      return {
        ...zip64,
        eocdOffset,
        zip64: true,
      };
    }

    const end = checkedAdd(
      centralDirectoryOffset32,
      centralDirectorySize32,
      'APK_ZIP_CD_OVERFLOW',
    );
    if (end > source.size) {
      throw new ApkParseError('APK_ZIP_CD_OUT_OF_BOUNDS', 'Central directory is outside the file.');
    }

    return {
      centralDirectoryOffset: centralDirectoryOffset32,
      centralDirectorySize: centralDirectorySize32,
      totalEntries: totalEntries16,
      eocdOffset,
      zip64: false,
    };
  }

  throw new ApkParseError('APK_EOCD_NOT_FOUND', 'ZIP End of Central Directory record is missing.');
}

interface ParsedZip64Extra {
  uncompressedSize?: number;
  compressedSize?: number;
  localHeaderOffset?: number;
}

function parseZip64Extra(
  extra: Uint8Array,
  needs: { uncompressed: boolean; compressed: boolean; offset: boolean },
): ParsedZip64Extra {
  const view = viewOf(extra);
  let cursor = 0;

  while (cursor < extra.byteLength) {
    requireRange(extra, cursor, 4);
    const id = view.getUint16(cursor, true);
    const length = view.getUint16(cursor + 2, true);
    cursor += 4;
    requireRange(extra, cursor, length);

    if (id === ZIP64_EXTRA_FIELD) {
      const result: ParsedZip64Extra = {};
      let valueOffset = cursor;

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

      if (
        (needs.uncompressed && result.uncompressedSize === undefined) ||
        (needs.compressed && result.compressedSize === undefined) ||
        (needs.offset && result.localHeaderOffset === undefined)
      ) {
        throw new ApkParseError('APK_ZIP64_EXTRA_INVALID', 'ZIP64 extra field is too short.');
      }

      return result;
    }

    cursor += length;
  }

  if (needs.uncompressed || needs.compressed || needs.offset) {
    throw new ApkParseError('APK_ZIP64_EXTRA_MISSING', 'Required ZIP64 extra field is missing.');
  }

  return {};
}

function parseCentralDirectory(
  bytes: Uint8Array,
  expectedEntries: number,
): CentralDirectoryEntry[] {
  const result: CentralDirectoryEntry[] = [];
  let cursor = 0;
  const view = viewOf(bytes);
  const decoder = new TextDecoder();

  while (cursor < bytes.byteLength) {
    if (result.length >= MAX_CENTRAL_DIRECTORY_ENTRIES) {
      throw new ApkParseError('APK_ZIP_ENTRY_LIMIT', 'ZIP contains too many central directory entries.');
    }
    requireRange(bytes, cursor, 46);
    if (view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
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

    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = decoder.decode(nameBytes);
    const extra = bytes.subarray(
      cursor + 46 + nameLength,
      cursor + 46 + nameLength + extraLength,
    );

    const needs = {
      uncompressed: uncompressed32 === 0xffffffff,
      compressed: compressed32 === 0xffffffff,
      offset: localOffset32 === 0xffffffff,
    };
    const zip64 = parseZip64Extra(extra, needs);
    const uncompressedSize = zip64.uncompressedSize ?? uncompressed32;
    const compressedSize = zip64.compressedSize ?? compressed32;
    const localHeaderOffset = zip64.localHeaderOffset ?? localOffset32;

    if (flags & 0x0001) {
      throw new ApkParseError('APK_ZIP_ENCRYPTED', 'Encrypted ZIP entries are not supported.');
    }

    result.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    cursor += recordLength;
  }

  if (result.length !== expectedEntries) {
    throw new ApkParseError('APK_CENTRAL_DIRECTORY_COUNT', 'Central directory entry count does not match the EOCD.');
  }

  return result;
}

/**
 * Reads the central directory with a single read of its byte range.
 */
export async function readCentralDirectory(
  source: RandomAccessSource,
  eocd?: EocdInfo,
): Promise<CentralDirectoryEntry[]> {
  const info = eocd ?? (await findEocd(source));
  if (info.centralDirectorySize > MAX_CENTRAL_DIRECTORY_BYTES) {
    throw new ApkParseError('APK_CENTRAL_DIRECTORY_LIMIT', 'Central directory exceeds 64 MiB.');
  }
  const end = checkedAdd(
    info.centralDirectoryOffset,
    info.centralDirectorySize,
    'APK_ZIP_CD_OVERFLOW',
  );
  if (end > source.size) {
    throw new ApkParseError('APK_ZIP_CD_OUT_OF_BOUNDS', 'Central directory is outside the file.');
  }

  const bytes = await source.read(info.centralDirectoryOffset, info.centralDirectorySize);
  return parseCentralDirectory(bytes, info.totalEntries);
}

async function readInflated(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }

    total = checkedAdd(total, result.value.byteLength, 'APK_INFLATED_SIZE_OVERFLOW');
    if (total > MAX_INFLATED_ENTRY_BYTES) {
      await reader.cancel();
      throw new ApkParseError('APK_INFLATED_LIMIT', 'Inflated ZIP entry exceeds 64 MiB.');
    }
    chunks.push(result.value);
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/**
 * Reads one ZIP entry. Stored entries are returned directly; deflated entries
 * require the runtime's Web CompressionStream implementation.
 */
export async function readEntry(
  source: RandomAccessSource,
  name: string,
  eocd?: EocdInfo,
  entries?: readonly CentralDirectoryEntry[],
): Promise<Uint8Array> {
  const directory = entries ?? (await readCentralDirectory(source, eocd));
  const entry = directory.find((candidate) => candidate.name === name);
  if (entry === undefined) {
    throw new ApkParseError('APK_ENTRY_NOT_FOUND', `ZIP entry not found: ${name}`);
  }

  if (entry.uncompressedSize > MAX_INFLATED_ENTRY_BYTES) {
    throw new ApkParseError('APK_INFLATED_LIMIT', 'ZIP entry exceeds 64 MiB.');
  }
  if (entry.compressedSize > source.size) {
    throw new ApkParseError('APK_ZIP_ENTRY_INVALID', 'ZIP entry size is impossible.');
  }

  const localHeader = await source.read(entry.localHeaderOffset, 30);
  if (readU32(localHeader, 0) !== LOCAL_FILE_SIGNATURE) {
    throw new ApkParseError('APK_LOCAL_HEADER_INVALID', 'Invalid ZIP local file header.');
  }

  const localView = viewOf(localHeader);
  const nameLength = localView.getUint16(26, true);
  const extraLength = localView.getUint16(28, true);
  const headerLength = 30 + nameLength + extraLength;
  const headerAndName = await source.read(entry.localHeaderOffset, headerLength);
  const dataOffset = checkedAdd(entry.localHeaderOffset, headerLength, 'APK_ZIP_DATA_OVERFLOW');
  const dataEnd = checkedAdd(dataOffset, entry.compressedSize, 'APK_ZIP_DATA_OVERFLOW');

  if (dataEnd > source.size) {
    throw new ApkParseError('APK_ZIP_DATA_OUT_OF_BOUNDS', 'ZIP entry data is outside the file.');
  }

  const data = await source.read(dataOffset, entry.compressedSize);
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) {
      throw new ApkParseError('APK_ZIP_SIZE_MISMATCH', 'Stored ZIP entry sizes do not match.');
    }
    return data;
  }

  if (entry.method !== 8) {
    throw new ApkParseError('APK_ZIP_METHOD_UNSUPPORTED', 'ZIP compression method is not supported.');
  }

  if (typeof globalThis.DecompressionStream !== 'function') {
    throw new ApkParseError(
      'APK_ZIP_DEFLATE_UNAVAILABLE',
      'Deflate decompression is unavailable in this runtime.',
    );
  }

  const compressed = new Blob([data]).stream();
  const decompressed = compressed.pipeThrough(new DecompressionStream('deflate-raw'));
  const inflated = await readInflated(decompressed);

  if (inflated.byteLength !== entry.uncompressedSize) {
    throw new ApkParseError('APK_ZIP_SIZE_MISMATCH', 'Inflated ZIP entry size does not match the central directory.');
  }

  void headerAndName;
  return inflated;
}
