import { DevVerifyError } from '../errors.js';

export interface RandomAccessSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface CountingRandomAccessSource extends RandomAccessSource {
  readonly bytesRead: number;
  readonly readCalls: number;
}

export interface VirtualPatch {
  readonly offset: number;
  readonly data: Uint8Array;
}

export class ApkParseError extends DevVerifyError {
  public constructor(code: string, message: string) {
    super(code, message);
    this.name = 'ApkParseError';
  }
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
    throw new ApkParseError('APK_READ_OUT_OF_BOUNDS', 'APK read is outside the source bounds.');
  }
}

function assertSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new ApkParseError('APK_INVALID_SIZE', 'Random-access source size is invalid.');
  }
}

export function createBufferSource(bytes: Uint8Array): RandomAccessSource {
  const copy = new Uint8Array(bytes);
  return {
    size: copy.byteLength,
    async read(offset: number, length: number): Promise<Uint8Array> {
      assertRange(copy.byteLength, offset, length);
      return copy.slice(offset, offset + length);
    },
  };
}

export function createCountingSource(
  inner: RandomAccessSource,
): CountingRandomAccessSource {
  let bytesRead = 0;
  let readCalls = 0;

  return {
    size: inner.size,
    get bytesRead(): number {
      return bytesRead;
    },
    get readCalls(): number {
      return readCalls;
    },
    async read(offset: number, length: number): Promise<Uint8Array> {
      const result = await inner.read(offset, length);
      bytesRead += result.byteLength;
      readCalls += 1;
      return result;
    },
  };
}

export function createVirtualSource(
  size: number,
  patches: readonly VirtualPatch[],
): RandomAccessSource {
  assertSize(size);

  const normalized = [...patches].sort((left, right) => left.offset - right.offset);
  let previousEnd = 0;

  for (const patch of normalized) {
    assertRange(size, patch.offset, patch.data.byteLength);
    if (patch.offset < previousEnd) {
      throw new ApkParseError('APK_OVERLAPPING_PATCHES', 'Virtual patches overlap.');
    }
    previousEnd = patch.offset + patch.data.byteLength;
  }

  return {
    size,
    async read(offset: number, length: number): Promise<Uint8Array> {
      assertRange(size, offset, length);
      const result = new Uint8Array(length);

      for (const patch of normalized) {
        if (patch.offset >= offset + length) {
          break;
        }
        const patchEnd = patch.offset + patch.data.byteLength;
        if (patchEnd <= offset) {
          continue;
        }

        const copyStart = Math.max(offset, patch.offset);
        const copyEnd = Math.min(offset + length, patchEnd);
        result.set(
          patch.data.subarray(copyStart - patch.offset, copyEnd - patch.offset),
          copyStart - offset,
        );
      }

      return result;
    },
  };
}
