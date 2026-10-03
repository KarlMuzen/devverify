import { DevVerifyError } from './errors.js';

const PACKAGE_SEGMENT = /^[A-Za-z][A-Za-z0-9_]*$/;
const MAX_PACKAGE_NAME_LENGTH = 255;

export class PackageNameError extends DevVerifyError {
  public constructor(message = 'Invalid package name.') {
    super('INVALID_PACKAGE_NAME', message);
    this.name = 'PackageNameError';
  }
}

/**
 * Returns true when the value matches the devverify Android package-name rules.
 */
export function isValidPackageName(value: string): boolean {
  if (value.length === 0 || value.length > MAX_PACKAGE_NAME_LENGTH) {
    return false;
  }

  const segments = value.split('.');
  return (
    segments.length >= 2 &&
    segments.every((segment) => PACKAGE_SEGMENT.test(segment))
  );
}

/**
 * Validates and returns an Android package name.
 */
export function assertPackageName(value: string): string {
  if (!isValidPackageName(value)) {
    throw new PackageNameError(`Invalid package name: ${value}`);
  }
  return value;
}
