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
    expect(readInteger(parseDer(hex('020101')))).toEqual(hex('01'));
    expect(readOid(parseDer(hex('06092a864886f70d010702')))).toBe('1.2.840.113549.1.7.2');

    const context = parseDer(hex('a003020101'));
    expect(readContextSpecific(context, 0)).toHaveLength(1);
    expect(isContextSpecific(context, 0)).toBe(true);

    expect(readSequence(parseDer(hex('3003020101')))).toHaveLength(1);
    expect(readSet(parseDer(hex('3103020101')))).toHaveLength(1);
  });

  it('accepts long-form definite lengths and high-tag numbers', () => {
    const highTag = new Uint8Array([0x1f, 0x20, 0x00]);
    expect(parseDer(highTag).tagNumber).toBe(32);
    expect(() => parseDer(new Uint8Array([0x1f, 0x81, 0x01, 0x00]))).not.toThrow();
    expect(() => parseDer(new Uint8Array([0x02, 0x82, 0x00, 0x80]))).toThrow();
  });

  it('rejects indefinite lengths', () => {
    expectErrorCode(() => parseDer(hex('30800201010000')), 'APK_DER_INDEFINITE_LENGTH');
  });

  it('rejects truncated values and non-minimal lengths', () => {
    expect(() => parseDer(hex('3003020101'))).not.toThrow();
    expect(() => parseDer(hex('3004020101'))).toThrowError(ApkParseError);
    expectErrorCode(() => parseDer(hex('30810100')), 'APK_DER_NON_MINIMAL_LENGTH');
    expectErrorCode(() => parseDer(hex('1f')), 'APK_DER_TRUNCATED');
    expectErrorCode(() => parseDer(hex('1f802000')), 'APK_DER_NON_MINIMAL_TAG');
  });

  it('rejects invalid helper values and non-minimal integers', () => {
    expect(() => readOid(parseDer(hex('06028000')))).toThrowError(ApkParseError);
    expect(() => readOid(parseDer(hex('060181')))).toThrowError(ApkParseError);
    expect(() => readInteger(parseDer(hex('02020001')))).toThrowError(ApkParseError);
    expect(() => readSequence(parseDer(hex('020101')))).toThrowError(ApkParseError);
    expect(() => readSet(parseDer(hex('3000')))).toThrowError(ApkParseError);
    expect(() => readContextSpecific(parseDer(hex('3000')), 0)).toThrowError(ApkParseError);
  });

  it('rejects malformed lengths and high-tag encodings', () => {
    expectErrorCode(
      () => parseDer(new Uint8Array([0x02])),
      'APK_DER_TRUNCATED',
    );
    expectErrorCode(
      () => parseDer(new Uint8Array([0x02, 0x89])),
      'APK_DER_LENGTH_OVERFLOW',
    );
    expectErrorCode(
      () => parseDer(new Uint8Array([0x02, 0x88, 0x20, 0, 0, 0, 0, 0, 0, 0])),
      'APK_DER_LENGTH_INVALID',
    );
    expectErrorCode(
      () => parseDer(new Uint8Array([0x1f, 0x1e, 0x00])),
      'APK_DER_NON_MINIMAL_TAG',
    );
    expectErrorCode(
      () => parseDer(new Uint8Array([0x1f, 0xff, 0xff, 0xff, 0xff, 0x7f, 0x00])),
      'APK_DER_TAG_OVERFLOW',
    );
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

    expectErrorCode(() => parseDer(bytes), 'APK_DER_DEPTH');
    expectErrorCode(() => parseDer(new Uint8Array([0x02, 0x01, 0x01, 0x00])), 'APK_DER_TRAILING');
  });
});

function expectErrorCode(action: () => unknown, code: string): void {
  let caught = false;
  try {
    action();
  } catch (error) {
    caught = true;
    expect(error).toBeInstanceOf(ApkParseError);
    if (error instanceof ApkParseError) {
      expect(error.code).toBe(code);
    }
  }
  if (!caught) throw new Error(`Expected ${code}.`);
}
