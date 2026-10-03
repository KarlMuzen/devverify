import { ApkParseError } from './source.js';

export class Cursor {
  public position = 0;

  public constructor(public readonly bytes: Uint8Array) {}

  public get remaining(): number {
    return this.bytes.byteLength - this.position;
  }

  public u32(): number {
    this.require(4);
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    const value = view.getUint32(this.position, true);
    this.position += 4;
    return value;
  }

  public u64(): number {
    this.require(8);
    const value = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset,
      this.bytes.byteLength,
    ).getBigUint64(this.position, true);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ApkParseError(
        'APK_SIGNING_BLOCK_U64_OVERFLOW',
        'APK signing value exceeds the supported range.',
      );
    }
    this.position += 8;
    return Number(value);
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
    return this.bytesOf(this.u32(), code);
  }

  public lp64(code = 'APK_SIGNING_BLOCK_FIELD_INVALID'): Uint8Array {
    return this.bytesOf(this.u64(), code);
  }

  public require(length: number): void {
    if (!Number.isSafeInteger(length) || length < 0 || this.remaining < length) {
      throw new ApkParseError(
        'APK_SIGNING_BLOCK_BOUNDS',
        'APK signing structure is truncated or out of bounds.',
      );
    }
  }
}

export function readId(bytes: Uint8Array): number {
  if (bytes.byteLength < 4) {
    throw new ApkParseError('APK_SIGNING_BLOCK_BOUNDS', 'Signing-block ID is truncated.');
  }
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
}
