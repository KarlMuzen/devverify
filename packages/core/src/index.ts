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

export {
  createStatusClient,
  STATUS_API_BASE_URL,
  type StatusCheckResult,
  type StatusClient,
  type StatusClientOptions,
  type StatusRequestInfo,
} from './status/client.js';
export {
  AuthError,
  BadRequestError,
  ProtocolError,
  QuotaExhaustedError,
  TransientError,
} from './status/errors.js';
export { BudgetExhaustedError, RequestBudget } from './status/budget.js';
export { createLimiter, type Limiter, type LimitTask } from './status/limiter.js';
export { createFakeStatusClient, type FakeStatusClient } from './status/fake.js';
export { redactSecrets } from './status/redact.js';

export const PACKAGE_NAME = '@devverify/core';
