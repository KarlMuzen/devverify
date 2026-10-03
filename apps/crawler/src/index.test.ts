import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index.js';

describe('crawler package', () => {
  it('loads', () => {
    expect(PACKAGE_NAME).toBe('@devverify/crawler');
  });
});
