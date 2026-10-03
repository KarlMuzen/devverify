import { describe, expect, it } from 'vitest';
import { parseBinaryXml } from './axml.js';
import { encodeManifest } from './tests/helpers/axml-encode.js';

describe('Android binary XML parser', () => {
  it.each([true, false])('parses %s string pools and manifest metadata', (utf8) => {
    expect(parseBinaryXml(encodeManifest({ utf8 }))).toEqual({
      packageName: 'com.example.test',
      versionCode: 42,
      versionName: '1.2.3',
      minSdk: 24,
      targetSdk: 35,
    });
  });

  it('tolerates optional resource-map and unknown chunks', () => {
    expect(parseBinaryXml(encodeManifest({ resourceMap: true, unknownChunk: true })).packageName)
      .toBe('com.example.test');
  });

  it('allows missing attributes', () => {
    const result = parseBinaryXml(encodeManifest({ includeSdk: false, includeVersionName: false }));
    expect(result).toEqual({
      packageName: 'com.example.test',
      versionCode: 42,
    });
  });

  it('rejects a root element other than manifest', () => {
    const bytes = encodeManifest();
    let start = -1;
    for (let offset = 0; offset + 2 <= bytes.byteLength; offset += 2) {
      if (new DataView(bytes.buffer).getUint16(offset, true) === 0x0102) {
        start = offset;
        break;
      }
    }
    expect(start).toBeGreaterThan(0);
    const broken = new Uint8Array(bytes);
    new DataView(broken.buffer).setUint32(start + 20, 1, true);
    expect(() => parseBinaryXml(broken)).toThrow(/root element is not manifest/i);
  });

  it('rejects malformed chunk sizes', () => {
    const bytes = encodeManifest();
    const broken = new Uint8Array(bytes);
    new DataView(broken.buffer).setUint32(4, 7, true);
    expect(() => parseBinaryXml(broken)).toThrow(/invalid/i);
  });

  it('rejects a truncated string pool', () => {
    const bytes = encodeManifest();
    expect(() => parseBinaryXml(bytes.subarray(0, 35))).toThrow();
  });
});
