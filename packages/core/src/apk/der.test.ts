import { describe, expect, it } from 'vitest';
import {
  MAX_DER_DEPTH,
  isContextSpecific,
  parseDer,
  readContextSpecific,
  readInteger,
  readOid,
  readSequence,
  readSet,
} from './der.js';
import { ApkParseError } from './source.js';

function hex(input: string): Uint8Array {
  return Uint8Array.from(input.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? []);
}

describe('minimal DER reader', () => {
  it('reads sequences, sets, integers, OIDs, and context-specific tags', () => {
    const root = parseDer(hex('3018300e02010106092a864886f70d010702a0030201013003020101'));
    const fields = readSequence(root);
    const first = fields[0];
    const oidFields = first === undefined ? [] : readSequence(first);

    expect(readInteger(oidFields[0] ?? root)).toEqual(hex('01'));
    expect(readOid(oidFields[1] ?? root)).toBe('1.2.840.113549.1.7.2');

    const context = fields[1];
    expect(context).toBeDefined();
    if (context !== undefined) {
      expect(readContextSpecific(context, 0)).toHaveLength(1);
      expect(isContextSpecific(context, 0)).toBe(true);
    }

    expect(readSet(parseDer(hex('3103020101')))).toHaveLength(1);
  });

  it('accepts long-form definite lengths and high-tag numbers', () => {
    const bytes = new Uint8Array([0x3f, 0x20, 0x01, 0x00]);
    expect(parseDer(bytes).tagNumber).toBe(0);
    expect(() => parseDer(new Uint8Array([0x3f, 0x81, 0x01, 0x00]))).not.toThrow();
  });

  it('rejects indefinite lengths', () => {
    expect(() => parseDer(hex('30800201010000'))).toThrowErrorMatchingObject({
      code: 'APK_DER_INDEFINITE_LENGTH',
    });
  });

  it('rejects truncated values and non-minimal lengths', () => {
    expect(() => parseDer(hex('3003020101'))).not.toThrow();
    expect(() => parseDer(hex('3004020101'))).toThrowError(ApkParseError);
    expect(() => parseDer(hex('30810100'))).toThrowErrorMatchingObject({
      code: 'APK_DER_NON_MINIMAL_LENGTH',
    });
    expect(() => parseDer(hex('1f'))).toThrowErrorMatchingObject({
      code: 'APK_DER_TRUNCATED',
    });
    expect(() => parseDer(hex('1f1f00'))).toThrowErrorMatchingObject({
      code: 'APK_DER_NON_MINIMAL_TAG',
    });
  });

  it('rejects invalid helper values and non-minimal integers', () => {
    expect(() => readOid(parseDer(hex('06028000')))).toThrowError(ApkParseError);
    expect(() => readOid(parseDer(hex('060181')))).toThrowError(ApkParseError);
    expect(() => readInteger(parseDer(hex('02020001')))).toThrowError(ApkParseError);
    expect(() => readSequence(parseDer(hex('020101')))).toThrowError(ApkParseError);
    expect(() => readSet(parseDer(hex('3000')))).toThrowError(ApkParseError);
    expect(() => readContextSpecific(parseDer(hex('3000')), 0)).toThrowError(ApkParseError);
  });

  it('rejects excessive depth and trailing bytes', () => {
    let bytes = hex('020101');
    for (let index = 0; index < MAX_DER_DEPTH + 1; index += 1) {
      const wrapped = new Uint8Array(bytes.byteLength + 2);
      wrapped[0] = 0x30;
      wrapped[1] = bytes.byteLength;
      wrapped.set(bytes, 2);
      bytes = wrapped;
    }

    expect(() => parseDer(bytes)).toThrowErrorMatchingObject({ code: 'APK_DER_DEPTH' });
    expect(() => parseDer(new Uint8Array([0x02, 0x01, 0x01, 0x00]))).toThrowErrorMatchingObject({
      code: 'APK_DER_TRAILING',
    });
  });
});
