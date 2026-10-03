import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index.js';

describe('cli package', () => {
  it('loads', () => {
    expect(PACKAGE_NAME).toBe('devverify');
  });
});
