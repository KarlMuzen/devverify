import { describe, expect, it } from 'vitest';

import { deriveAppStatus, type FingerprintStatusResult } from './derive.js';

const result = (state: FingerprintStatusResult['state']): FingerprintStatusResult => ({
  fingerprint: 'ignored',
  state,
});

describe('deriveAppStatus', () => {
  it.each([
    [[], 'unknown'],
    [[result('UNKNOWN')], 'unknown'],
    [[result('NOT_REGISTERED')], 'not_registered'],
    [[result('REGISTERED_WITH_ANOTHER_CERTIFICATE_FINGERPRINT')], 'registered_other_key'],
    [[result('REGISTERED'), result('NOT_REGISTERED')], 'registered'],
    [
      [
        result('REGISTERED_WITH_ANOTHER_CERTIFICATE_FINGERPRINT'),
        result('NOT_REGISTERED'),
      ],
      'registered_other_key',
    ],
    [
      [
        result('REGISTERED'),
        result('REGISTERED_WITH_ANOTHER_CERTIFICATE_FINGERPRINT'),
        result('NOT_REGISTERED'),
      ],
      'registered',
    ],
    [[result('UNKNOWN'), result('NOT_REGISTERED')], 'not_registered'],
  ])('derives the expected status', (results, expected) => {
    expect(deriveAppStatus(results)).toBe(expected);
  });
});
