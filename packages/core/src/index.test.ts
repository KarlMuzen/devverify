import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index.js';

describe('core package', () => {
  it('loads', () => {
    expect(PACKAGE_NAME).toBe('@devverify/core');
  });
});
