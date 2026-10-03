import { describe, expect, it } from 'vitest';

import { deriveAppStatus, type FingerprintStatusResult } from './derive.js';
import type { ApiState } from './types.js';

const result = (state: ApiState): FingerprintStatusResult => ({
  fingerprint: 'ignored',
  state,
});

const STATES: ApiState[] = [
  'REGISTERED',
  'REGISTERED_WITH_ANOTHER_CERTIFICATE_FINGERPRINT',
  'NOT_REGISTERED',
  'UNKNOWN',
];

function expectedStatus(states: ApiState[]): ReturnType<typeof deriveAppStatus> {
  if (states.includes('REGISTERED')) {
    return 'registered';
  }
  if (states.includes('REGISTERED_WITH_ANOTHER_CERTIFICATE_FINGERPRINT')) {
    return 'registered_other_key';
  }
  if (states.includes('NOT_REGISTERED')) {
    return 'not_registered';
  }
  return 'unknown';
}

const matrix: Array<[ApiState[], ReturnType<typeof deriveAppStatus>]> = [];
for (let mask = 0; mask < 1 << STATES.length; mask += 1) {
  const states = STATES.filter((_, index) => (mask & (1 << index)) !== 0);
  matrix.push([states, expectedStatus(states)]);
}

describe('deriveAppStatus', () => {
  it.each(matrix)('derives the expected status for %s', (states, expected) => {
    expect(deriveAppStatus(states.map(result))).toBe(expected);
  });
});
