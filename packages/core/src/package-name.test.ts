import { describe, expect, it } from 'vitest';

import {
  PackageNameError,
  assertPackageName,
  isValidPackageName,
} from './package-name.js';

describe('package names', () => {
  it.each([
    ['com.example.app', true],
    ['a.b', true],
    ['A1.ok_1.abc9', true],
    ['1com.example', false],
    ['example', false],
    ['com-example.app', false],
    ['com.example.', false],
    ['com..example', false],
  ])('validates %s as %s', (value, expected) => {
    expect(isValidPackageName(value)).toBe(expected);
  });

  it('rejects empty values and values longer than 255 characters', () => {
    expect(isValidPackageName('')).toBe(false);
    expect(isValidPackageName(`a.${'b'.repeat(254)}`)).toBe(false);
  });

  it('accepts the maximum length', () => {
    const value = `a.${'b'.repeat(253)}`;
    expect(value).toHaveLength(255);
    expect(isValidPackageName(value)).toBe(true);
  });

  it('asserts and returns valid names', () => {
    expect(assertPackageName('com.example.app')).toBe('com.example.app');
  });

  it('throws a typed error for invalid names', () => {
    expect(() => assertPackageName('invalid-name')).toThrow(PackageNameError);
    try {
      assertPackageName('invalid-name');
    } catch (error) {
      expect(error).toBeInstanceOf(PackageNameError);
      expect((error as PackageNameError).code).toBe('INVALID_PACKAGE_NAME');
    }
  });
});
