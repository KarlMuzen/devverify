import {
  checkedAdd,
  readU32,
  viewOf,
  type EocdInfo,
} from './eocd.js';
import { readCentralDirectory, type CentralDirectoryEntry } from './central-directory.js';
import { ApkParseError, type RandomAccessSource } from './source.js';

export const MAX_INFLATED_ENTRY_BYTES = 64 * 1024 * 1024;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

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

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
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

  const localHeader = await source.read(entry.localHeaderOffset, 30);
  if (readU32(localHeader, 0) !== LOCAL_FILE_SIGNATURE) {
    throw new ApkParseError('APK_LOCAL_HEADER_INVALID', 'Invalid ZIP local file header.');
  }

  const headerView = viewOf(localHeader);
  const nameLength = headerView.getUint16(26, true);
  const extraLength = headerView.getUint16(28, true);
  const headerLength = 30 + nameLength + extraLength;
  await source.read(entry.localHeaderOffset, headerLength);

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

  const exactBuffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(exactBuffer).set(data);
  const compressed = new Blob([exactBuffer]).stream();
  const inflated = await readInflated(
    compressed.pipeThrough(new DecompressionStream('deflate-raw')),
  );

  if (inflated.byteLength !== entry.uncompressedSize) {
    throw new ApkParseError(
      'APK_ZIP_SIZE_MISMATCH',
      'Inflated ZIP entry size does not match the central directory.',
    );
  }

  return inflated;
}
