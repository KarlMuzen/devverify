import { ApkParseError } from './source.js';

export interface StringPool {
  readonly strings: string[];
}

const UTF8_FLAG = 0x00000100;
const NO_INDEX = 0xffffffff;

function fail(code: string, message: string): never {
  throw new ApkParseError(code, message);
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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
    fail('APK_AXML_BOUNDS', 'Android binary XML structure is truncated or out of bounds.');
  }
}

function readU16(bytes: Uint8Array, offset: number): number {
  requireRange(bytes, offset, 2);
  return viewOf(bytes).getUint16(offset, true);
}

function readU32(bytes: Uint8Array, offset: number): number {
  requireRange(bytes, offset, 4);
  return viewOf(bytes).getUint32(offset, true);
}

function readLength8(bytes: Uint8Array, offset: number): { readonly length: number; readonly next: number } {
  requireRange(bytes, offset, 1);
  const first = bytes[offset] ?? 0;
  if ((first & 0x80) === 0) return { length: first, next: offset + 1 };
  requireRange(bytes, offset, 2);
  return {
    length: ((first & 0x7f) << 8) | (bytes[offset + 1] ?? 0),
    next: offset + 2,
  };
}

function readLength16(bytes: Uint8Array, offset: number): { readonly length: number; readonly next: number } {
  const first = readU16(bytes, offset);
  if ((first & 0x8000) === 0) return { length: first, next: offset + 2 };
  const second = readU16(bytes, offset + 2);
  return {
    length: ((first & 0x7fff) << 16) | second,
    next: offset + 4,
  };
}

function decodeUtf8(bytes: Uint8Array, offset: number, length: number): string {
  requireRange(bytes, offset, length + 1);
  if (bytes[offset + length] !== 0) {
    fail('APK_AXML_STRING_TERMINATOR', 'UTF-8 string is missing its terminator.');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + length));
  } catch {
    return fail('APK_AXML_STRING_ENCODING', 'UTF-8 string is invalid.');
  }
}

function decodeUtf16(bytes: Uint8Array, offset: number, length: number): string {
  const byteLength = length * 2;
  requireRange(bytes, offset, byteLength + 2);
  if (readU16(bytes, offset + byteLength) !== 0) {
    fail('APK_AXML_STRING_TERMINATOR', 'UTF-16 string is missing its terminator.');
  }
  const chunks: string[] = [];
  for (let cursor = 0; cursor < length; cursor += 4096) {
    const end = Math.min(length, cursor + 4096);
    const units: number[] = [];
    for (let index = cursor; index < end; index += 1) {
      units.push(readU16(bytes, offset + index * 2));
    }
    chunks.push(String.fromCharCode(...units));
  }
  return chunks.join('');
}

export function parseStringPool(
  bytes: Uint8Array,
  offset: number,
  size: number,
  headerSize: number,
): StringPool {
  if (headerSize < 28 || size < headerSize) {
    fail('APK_AXML_STRING_POOL', 'String-pool header is invalid.');
  }
  const count = readU32(bytes, offset + 8);
  const styleCount = readU32(bytes, offset + 12);
  const flags = readU32(bytes, offset + 16);
  const stringsStart = readU32(bytes, offset + 20);
  if (stringsStart > size) {
    fail('APK_AXML_STRING_POOL', 'String-pool string-data offset is invalid.');
  }

  const offsetsStart = offset + headerSize;
  const offsetsLength = count * 4;
  requireRange(bytes, offsetsStart, offsetsLength);
  const stringsOffset = offset + stringsStart;
  const stringsLength = size - stringsStart;
  requireRange(bytes, stringsOffset, stringsLength);

  if (styleCount > 0) {
    const stylesStart = readU32(bytes, offset + 24);
    if (stylesStart > size) {
      fail('APK_AXML_STRING_POOL', 'String-pool style-data offset is invalid.');
    }
    if (stylesStart !== 0) requireRange(bytes, offset + stylesStart, size - stylesStart);
  }

  const strings: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const relative = readU32(bytes, offsetsStart + index * 4);
    if (relative >= stringsLength) {
      fail('APK_AXML_STRING_INDEX', 'String-pool offset is outside the chunk.');
    }
    const stringOffset = stringsOffset + relative;
    if ((flags & UTF8_FLAG) !== 0) {
      const charLength = readLength8(bytes, stringOffset);
      const byteLength = readLength8(bytes, charLength.next);
      strings.push(decodeUtf8(bytes, byteLength.next, byteLength.length));
    } else {
      const stringLength = readLength16(bytes, stringOffset);
      strings.push(decodeUtf16(bytes, stringLength.next, stringLength.length));
    }
  }
  return { strings };
}

export function stringAt(pool: StringPool, index: number): string {
  if (index === NO_INDEX) return '';
  const value = pool.strings[index];
  if (value === undefined) fail('APK_AXML_STRING_INDEX', 'String-pool index is invalid.');
  return value;
}

export function optionalString(pool: StringPool, index: number): string | undefined {
  return index === NO_INDEX ? undefined : stringAt(pool, index);
}
