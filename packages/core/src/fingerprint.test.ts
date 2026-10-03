import { describe, expect, it } from 'vitest';

import {
  FingerprintError,
  equalFingerprints,
  formatFingerprint,
  normalizeFingerprint,
  sha256Hex,
} from './fingerprint.js';

const HEX_FINGERPRINT =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const COLON_FINGERPRINT =
  '01:23:45:67:89:ab:cd:ef:01:23:45:67:89:ab:cd:ef:01:23:45:67:89:ab:cd:ef:01:23:45:67:89:ab:cd:ef';

describe('fingerprints', () => {
  it.each([
    [HEX_FINGERPRINT, HEX_FINGERPRINT],
    [HEX_FINGERPRINT.toUpperCase(), HEX_FINGERPRINT],
    [COLON_FINGERPRINT, HEX_FINGERPRINT],
    [COLON_FINGERPRINT.toUpperCase(), HEX_FINGERPRINT],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeFingerprint(input)).toBe(expected);
  });

  it.each([
    HEX_FINGERPRINT.slice(0, 63),
    `${HEX_FINGERPRINT}0`,
    HEX_FINGERPRINT.replace('a', 'g'),
  ])('rejects invalid fingerprint %s', (input) => {
    expect(() => normalizeFingerprint(input)).toThrow(FingerprintError);
  });

  it('formats fingerprints as hex or uppercase colon-separated output', () => {
    expect(formatFingerprint(HEX_FINGERPRINT, 'hex')).toBe(HEX_FINGERPRINT);
    expect(formatFingerprint(HEX_FINGERPRINT, 'colon-upper')).toBe(COLON_FINGERPRINT.toUpperCase());
  });

  it('compares fingerprints after normalization', () => {
    expect(equalFingerprints(HEX_FINGERPRINT, COLON_FINGERPRINT.toUpperCase())).toBe(true);
    expect(equalFingerprints(HEX_FINGERPRINT, `ff${HEX_FINGERPRINT.slice(2)}`)).toBe(false);
  });

  it('computes SHA-256 with Web Crypto', async () => {
    const bytes = new TextEncoder().encode('devverify');
    await expect(sha256Hex(bytes)).resolves.toBe(
      'b34fc725fce2a4122e736b66f4842c99ce406bf4d75fa7aef9fefc82889b0e08',
    );
  });
});
