import { describe, expect, it } from 'vitest';

import { mapApiState, type ApiState } from './types.js';

describe('mapApiState', () => {
  it.each([
    ['REGISTERED', 'REGISTERED'],
    ['NOT_REGISTERED', 'NOT_REGISTERED'],
    [
      'REGISTERED_WITH_ANOTHER_CERTIFICATE_FINGERPRINT',
      'REGISTERED_WITH_ANOTHER_CERTIFICATE_FINGERPRINT',
    ],
    ['unexpected', 'UNKNOWN'],
    ['', 'UNKNOWN'],
    ['registered', 'UNKNOWN'],
  ] satisfies Array<[string, ApiState]>)('maps %s', (raw, expected) => {
    expect(mapApiState(raw)).toBe(expected);
  });
});
