export { DISCLAIMER, PROJECT_NAME } from './brand.js';
export { DevVerifyError } from './errors.js';
export {
  FingerprintError,
  equalFingerprints,
  formatFingerprint,
  normalizeFingerprint,
  sha256Hex,
  type FingerprintFormat,
} from './fingerprint.js';
export {
  PackageNameError,
  assertPackageName,
  isValidPackageName,
} from './package-name.js';
export { deriveAppStatus, type FingerprintStatusResult } from './status/derive.js';
export {
  mapApiState,
  type ApiState,
  type AppStatus,
} from './status/types.js';

export const PACKAGE_NAME = '@devverify/core';
