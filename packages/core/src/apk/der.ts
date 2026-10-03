import { ApkParseError } from './source.js';

export const MAX_DER_DEPTH = 16;

export interface DerNode {
  readonly tagClass: number;
  readonly tagNumber: number;
  readonly constructed: boolean;
  readonly length: number;
  readonly value: Uint8Array;
  readonly encoded: Uint8Array;
  readonly children: readonly DerNode[];
}

interface Cursor {
  position: number;
}

function fail(code: string, message: string): never {
  throw new ApkParseError(code, message);
}

function readLength(bytes: Uint8Array, cursor: Cursor): number {
  if (cursor.position >= bytes.byteLength) {
    return fail('APK_DER_TRUNCATED', 'DER length is truncated.');
  }

  const first = bytes[cursor.position++] ?? 0;
  if ((first & 0x80) === 0) return first;

  const count = first & 0x7f;
  if (count === 0) {
    return fail('APK_DER_INDEFINITE_LENGTH', 'Indefinite DER lengths are not supported.');
  }
  if (count > 8) {
    return fail('APK_DER_LENGTH_OVERFLOW', 'DER length uses too many octets.');
  }
  if (cursor.position + count > bytes.byteLength) {
    return fail('APK_DER_TRUNCATED', 'DER length octets are truncated.');
  }

  if ((bytes[cursor.position] ?? 0) === 0) {
    return fail('APK_DER_NON_MINIMAL_LENGTH', 'DER length is not minimally encoded.');
  }

  let value = 0n;
  for (let index = 0; index < count; index += 1) {
    value = (value << 8n) | BigInt(bytes[cursor.position++] ?? 0);
  }
  if (value < 128n) {
    return fail('APK_DER_NON_MINIMAL_LENGTH', 'DER long-form length is not minimally encoded.');
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return fail('APK_DER_LENGTH_INVALID', 'DER length is too large.');
  }
  return Number(value);
}

function readTag(bytes: Uint8Array, cursor: Cursor): {
  tagClass: number;
  tagNumber: number;
  constructed: boolean;
} {
  if (cursor.position >= bytes.byteLength) {
    return fail('APK_DER_TRUNCATED', 'DER tag is truncated.');
  }

  const first = bytes[cursor.position++] ?? 0;
  const tagClass = first >>> 6;
  const constructed = (first & 0x20) !== 0;
  let tagNumber = first & 0x1f;

  if (tagNumber !== 0x1f) {
    return { tagClass, tagNumber, constructed };
  }

  tagNumber = 0;
  let sawOctet = false;
  while (true) {
    if (cursor.position >= bytes.byteLength) {
      return fail('APK_DER_TRUNCATED', 'DER high-tag number is truncated.');
    }
    const octet = bytes[cursor.position++] ?? 0;
    if (!sawOctet && (octet & 0x7f) === 0) {
      return fail('APK_DER_NON_MINIMAL_TAG', 'DER high-tag number is not minimally encoded.');
    }
    sawOctet = true;
    if (tagNumber > 0x1fffffff) {
      return fail('APK_DER_TAG_OVERFLOW', 'DER tag number is too large.');
    }
    tagNumber = tagNumber * 128 + (octet & 0x7f);
    if ((octet & 0x80) === 0) break;
  }
  if (tagNumber < 31) {
    return fail('APK_DER_NON_MINIMAL_TAG', 'DER high-tag number is not minimally encoded.');
  }
  return { tagClass, tagNumber, constructed };
}

function parseNode(bytes: Uint8Array, cursor: Cursor, depth: number): DerNode {
  if (depth > MAX_DER_DEPTH) {
    return fail('APK_DER_DEPTH', 'DER nesting exceeds the supported depth.');
  }

  const start = cursor.position;
  const tag = readTag(bytes, cursor);
  const length = readLength(bytes, cursor);
  const valueStart = cursor.position;
  if (length > bytes.byteLength - valueStart) {
    return fail('APK_DER_BOUNDS', 'DER value exceeds the available bytes.');
  }
  cursor.position += length;

  const value = bytes.subarray(valueStart, cursor.position);
  const encoded = bytes.subarray(start, cursor.position);
  const children: DerNode[] = [];

  if (tag.constructed) {
    const childCursor: Cursor = { position: 0 };
    while (childCursor.position < value.byteLength) {
      children.push(parseNode(value, childCursor, depth + 1));
    }
  }

  return { ...tag, length, value, encoded, children };
}

/**
 * Parses one complete DER value. BER indefinite lengths are rejected.
 */
export function parseDer(bytes: Uint8Array): DerNode {
  const cursor: Cursor = { position: 0 };
  const node = parseNode(bytes, cursor, 0);
  if (cursor.position !== bytes.byteLength) {
    throw new ApkParseError('APK_DER_TRAILING', 'DER input contains trailing bytes.');
  }
  return node;
}

export function readSequence(node: DerNode, code = 'APK_DER_SEQUENCE'): readonly DerNode[] {
  if (node.tagClass !== 0 || node.tagNumber !== 16 || !node.constructed) {
    throw new ApkParseError(code, 'Expected a DER SEQUENCE.');
  }
  return node.children;
}

export function readSet(node: DerNode, code = 'APK_DER_SET'): readonly DerNode[] {
  if (node.tagClass !== 0 || node.tagNumber !== 17 || !node.constructed) {
    throw new ApkParseError(code, 'Expected a DER SET.');
  }
  return node.children;
}

export function readInteger(node: DerNode, code = 'APK_DER_INTEGER'): Uint8Array {
  if (node.tagClass !== 0 || node.tagNumber !== 2 || node.constructed || node.value.byteLength === 0) {
    throw new ApkParseError(code, 'Expected a DER INTEGER.');
  }
  const first = node.value[0] ?? 0;
  const second = node.value[1];
  if (
    node.value.byteLength > 1 &&
    second !== undefined &&
    ((first === 0x00 && (second & 0x80) === 0) ||
      (first === 0xff && (second & 0x80) !== 0))
  ) {
    throw new ApkParseError(code, 'DER INTEGER is not minimally encoded.');
  }
  return node.value;
}

export function readOid(node: DerNode, code = 'APK_DER_OID'): string {
  if (node.tagClass !== 0 || node.tagNumber !== 6 || node.constructed || node.value.byteLength === 0) {
    throw new ApkParseError(code, 'Expected a DER OBJECT IDENTIFIER.');
  }

  const arcs: bigint[] = [];
  let position = 0;
  while (position < node.value.byteLength) {
    let value = 0n;
    let octets = 0;
    let terminated = false;
    while (position < node.value.byteLength) {
      const octet = node.value[position++] ?? 0;
      if (octets === 0 && (octet & 0x7f) === 0 && (octet & 0x80) !== 0) {
        throw new ApkParseError(code, 'DER OBJECT IDENTIFIER arc is not minimally encoded.');
      }
      value = (value << 7n) | BigInt(octet & 0x7f);
      octets += 1;
      if ((octet & 0x80) === 0) {
        terminated = true;
        break;
      }
    }
    if (!terminated) {
      throw new ApkParseError(code, 'DER OBJECT IDENTIFIER arc is truncated.');
    }
    arcs.push(value);
  }

  const first = arcs[0];
  if (first === undefined) {
    throw new ApkParseError(code, 'DER OBJECT IDENTIFIER has no arcs.');
  }
  const firstArc = first < 40n ? 0n : first < 80n ? 1n : 2n;
  const secondArc = first - (firstArc === 2n ? 80n : firstArc * 40n);
  return [firstArc, secondArc, ...arcs.slice(1)].map((arc) => arc.toString()).join('.');
}

export function isContextSpecific(
  node: DerNode,
  tagNumber: number,
  constructed = true,
): boolean {
  return node.tagClass === 2 && node.tagNumber === tagNumber && node.constructed === constructed;
}

export function readContextSpecific(
  node: DerNode,
  tagNumber: number,
  code = 'APK_DER_CONTEXT',
): readonly DerNode[] {
  if (!isContextSpecific(node, tagNumber, true)) {
    throw new ApkParseError(code, 'Unexpected context-specific DER tag.');
  }
  return node.children;
}
