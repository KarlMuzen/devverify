import { open, type FileHandle } from 'node:fs/promises';

import type { RandomAccessSource } from './apk/source.js';

export interface FileRandomAccessSource extends RandomAccessSource {
  readonly close: () => Promise<void>;
}

function assertRange(size: number, offset: number, length: number): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > size ||
    length > size - offset
  ) {
    throw new RangeError('File read is outside the source bounds.');
  }
}

/**
 * Opens a local APK as a bounded RandomAccessSource. The caller owns the
 * returned handle and should call close() after parsing.
 */
export async function fileSource(path: string | URL): Promise<FileRandomAccessSource> {
  const handle: FileHandle = await open(path, 'r');
  const stat = await handle.stat();
  if (!Number.isSafeInteger(stat.size) || stat.size < 0) {
    await handle.close();
    throw new RangeError('APK file size is outside the supported range.');
  }

  return {
    size: stat.size,
    async read(offset: number, length: number): Promise<Uint8Array> {
      assertRange(stat.size, offset, length);
      const buffer = new Uint8Array(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (bytesRead !== length) {
        throw new RangeError('APK file ended before the requested range was read.');
      }
      return buffer;
    },
    close: async (): Promise<void> => {
      await handle.close();
    },
  };
}

export {
  createDataStore,
  DataStoreError,
  type DataStore,
  type FilePaths,
  type FsAdapter,
  type MetaMigration,
} from './data/store.js';
