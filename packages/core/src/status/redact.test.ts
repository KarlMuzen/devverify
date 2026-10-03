import { describe, expect, it } from 'vitest';
import { redactSecrets } from './redact.js';

describe('redactSecrets', () => {
  it('replaces all non-empty secrets and handles overlapping values', () => {
    expect(
      redactSecrets('prefix-longsecret-secret-suffix', ['secret', 'longsecret']),
    ).toBe('prefix-[REDACTED]-[REDACTED]-suffix');
    expect(redactSecrets('same', [''])).toBe('same');
  });
});
