import { ApkParseError } from './source.js';
import { optionalString, parseStringPool, stringAt, type StringPool } from './axml-strings.js';

export const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;

const XML_HEADER = 0x0003;
const STRING_POOL = 0x0001;
const RESOURCE_MAP = 0x0180;
const START_NAMESPACE = 0x0100;
const END_NAMESPACE = 0x0101;
const START_ELEMENT = 0x0102;
const END_ELEMENT = 0x0103;
const VALUE_STRING = 0x03;
const VALUE_INT_DEC = 0x10;
const VALUE_INT_HEX = 0x11;
const ANDROID_NS = 'http://schemas.android.com/apk/res/android';

export interface ParsedManifest {
  readonly packageName: string;
  readonly versionCode?: number;
  readonly versionName?: string;
  readonly minSdk?: number;
  readonly targetSdk?: number;
}

interface Attribute {
  readonly namespace: string | undefined;
  readonly name: string;
  readonly type: number;
  readonly data: number;
  readonly value: string | undefined;
}

interface Element {
  readonly name: string;
  readonly attributes: readonly Attribute[];
}

function fail(code: string, message: string): never {
  throw new ApkParseError(code, message);
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function requireRange(bytes: Uint8Array, offset: number, length: number, code = 'APK_AXML_BOUNDS'): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > bytes.byteLength ||
    length > bytes.byteLength - offset
  ) {
    fail(code, 'Android binary XML structure is truncated or out of bounds.');
  }
}

function readU16(bytes: Uint8Array, offset: number, code = 'APK_AXML_BOUNDS'): number {
  requireRange(bytes, offset, 2, code);
  return viewOf(bytes).getUint16(offset, true);
}

function readU32(bytes: Uint8Array, offset: number, code = 'APK_AXML_BOUNDS'): number {
  requireRange(bytes, offset, 4, code);
  return viewOf(bytes).getUint32(offset, true);
}

function chunkBounds(
  bytes: Uint8Array,
  offset: number,
): { readonly type: number; readonly headerSize: number; readonly size: number } {
  requireRange(bytes, offset, 8);
  const type = readU16(bytes, offset);
  const headerSize = readU16(bytes, offset + 2);
  const size = readU32(bytes, offset + 4);
  if (headerSize < 8 || size < headerSize) {
    fail('APK_AXML_CHUNK_INVALID', 'Android binary XML chunk header is invalid.');
  }
  requireRange(bytes, offset, size, 'APK_AXML_CHUNK_BOUNDS');
  return { type, headerSize, size };
}

function parseAttribute(
  bytes: Uint8Array,
  pool: StringPool,
  offset: number,
  attributeSize: number,
): Attribute {
  if (attributeSize < 20) fail('APK_AXML_ATTRIBUTE', 'Android attribute size is too small.');
  const namespace = optionalString(pool, readU32(bytes, offset));
  const name = stringAt(pool, readU32(bytes, offset + 4));
  const valueType = bytes[offset + 15];
  const valueData = readU32(bytes, offset + 16);
  if (readU16(bytes, offset + 12) !== 8 || bytes[offset + 14] !== 0 || valueType === undefined) {
    fail('APK_AXML_ATTRIBUTE', 'Android attribute typed-value header is invalid.');
  }
  return {
    namespace,
    name,
    type: valueType,
    data: valueData,
    value: valueType === VALUE_STRING ? stringAt(pool, valueData) : undefined,
  };
}

function parseStartElement(
  bytes: Uint8Array,
  pool: StringPool,
  offset: number,
  size: number,
): Element {
  if (size < 36) fail('APK_AXML_ELEMENT', 'Start-element chunk is too small.');
  const name = stringAt(pool, readU32(bytes, offset + 20));
  const attributeStart = readU16(bytes, offset + 24);
  const attributeSize = readU16(bytes, offset + 26);
  const attributeCount = readU16(bytes, offset + 28);
  if (attributeStart < 20 || attributeSize < 20) {
    fail('APK_AXML_ELEMENT', 'Start-element attribute metadata is invalid.');
  }
  const attributesOffset = offset + 16 + attributeStart;
  const attributesLength = attributeCount * attributeSize;
  requireRange(bytes, attributesOffset, attributesLength, 'APK_AXML_ATTRIBUTE');
  if (attributesOffset + attributesLength > offset + size) {
    fail('APK_AXML_ATTRIBUTE', 'Start-element attributes exceed their chunk.');
  }
  const attributes: Attribute[] = [];
  for (let index = 0; index < attributeCount; index += 1) {
    attributes.push(parseAttribute(bytes, pool, attributesOffset + index * attributeSize, attributeSize));
  }
  return { name, attributes };
}

function findAttribute(
  element: Element,
  namespace: string | undefined,
  name: string,
): Attribute | undefined {
  return element.attributes.find(
    (attribute) =>
      attribute.name === name &&
      (namespace === undefined ? attribute.namespace === undefined : attribute.namespace === namespace),
  );
}

function readIntegerAttribute(attribute: Attribute | undefined): number | undefined {
  return attribute !== undefined &&
    (attribute.type === VALUE_INT_DEC || attribute.type === VALUE_INT_HEX)
    ? attribute.data
    : undefined;
}

/**
 * Parses Android binary XML and extracts manifest and uses-sdk metadata.
 */
export function parseBinaryXml(bytes: Uint8Array): ParsedManifest {
  if (bytes.byteLength > MAX_MANIFEST_BYTES) {
    fail('APK_AXML_LIMIT', 'Android manifest exceeds 8 MiB.');
  }

  const header = chunkBounds(bytes, 0);
  if (header.type !== XML_HEADER || header.headerSize !== 8 || header.size !== 8) {
    fail('APK_AXML_HEADER', 'Android binary XML header is invalid.');
  }

  let cursor = header.size;
  const stringChunk = chunkBounds(bytes, cursor);
  if (stringChunk.type !== STRING_POOL) {
    fail('APK_AXML_STRING_POOL', 'Android binary XML string pool is missing.');
  }
  const pool = parseStringPool(bytes, cursor, stringChunk.size, stringChunk.headerSize);
  cursor += stringChunk.size;

  let root: Element | undefined;
  let rootDepth = 0;
  let rootClosed = false;
  let depth = 0;
  let manifest: ParsedManifest | undefined;
  const stack: string[] = [];

  while (cursor < bytes.byteLength) {
    const chunk = chunkBounds(bytes, cursor);
    switch (chunk.type) {
      case RESOURCE_MAP:
      case START_NAMESPACE:
      case END_NAMESPACE:
        break;
      case START_ELEMENT: {
        if (rootClosed) fail('APK_AXML_ROOT', 'Android binary XML contains more than one root element.');
        const element = parseStartElement(bytes, pool, cursor, chunk.size);
        depth += 1;
        stack.push(element.name);
        if (root === undefined) {
          if (element.name !== 'manifest') {
            fail('APK_AXML_ROOT', 'Android binary XML root element is not manifest.');
          }
          root = element;
          rootDepth = depth;
          const packageName = findAttribute(element, undefined, 'package')?.value;
          if (packageName === undefined || packageName.length === 0) {
            fail('APK_AXML_MANIFEST', 'Android manifest package attribute is missing.');
          }
          const versionCode = readIntegerAttribute(findAttribute(element, ANDROID_NS, 'versionCode'));
          const versionName = findAttribute(element, ANDROID_NS, 'versionName');
          manifest = {
            packageName,
            ...(versionCode === undefined ? {} : { versionCode }),
            ...(versionName?.type === VALUE_STRING ? { versionName: versionName.value } : {}),
          };
        } else if (element.name === 'uses-sdk' && depth === rootDepth + 1 && manifest !== undefined) {
          const minSdk = readIntegerAttribute(findAttribute(element, ANDROID_NS, 'minSdkVersion'));
          const targetSdk = readIntegerAttribute(
            findAttribute(element, ANDROID_NS, 'targetSdkVersion'),
          );
          manifest = {
            ...manifest,
            ...(minSdk === undefined ? {} : { minSdk }),
            ...(targetSdk === undefined ? {} : { targetSdk }),
          };
        }
        break;
      }
      case END_ELEMENT: {
        requireRange(bytes, cursor, 24, 'APK_AXML_ELEMENT');
        const name = stringAt(pool, readU32(bytes, cursor + 20));
        if (stack.pop() !== name) {
          fail('APK_AXML_ELEMENT', 'Android binary XML element nesting is invalid.');
        }
        depth -= 1;
        if (root !== undefined && depth === 0) rootClosed = true;
        break;
      }
      default:
        break;
    }
    cursor += chunk.size;
  }

  if (root === undefined || manifest === undefined || depth !== 0 || stack.length !== 0) {
    fail('APK_AXML_MANIFEST', 'Android binary XML does not contain a complete manifest.');
  }
  return manifest;
}
