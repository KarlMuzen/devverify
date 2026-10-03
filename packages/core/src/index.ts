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

export {
  type PackageSource,
  type SourceLoadOptions,
  type SourceSnapshot,
  type SourceValidators,
  SourceFetchError,
  SourceFormatError,
} from './source.js';
export {
  createFdroidSource,
  FDROID_SIGNER_INDEX_URL,
  MAX_SIGNER_INDEX_BYTES,
  SIGNER_INDEX_TIMEOUT_MS,
  parseSignerIndex,
  type ParsedSignerIndex,
  type SignerIndexEntry,
  type SignerIndexShape,
} from './fdroid/index.js';

export const PACKAGE_NAME = '@devverify/core';

export {
  ApkParseError,
  createBufferSource,
  createCountingSource,
  createVirtualSource,
  extractApkSigners,
  findEocd,
  readCentralDirectory,
  readEntry,
  readSigningBlock,
  parseApk,
  parseBinaryXml,
  MAX_CENTRAL_DIRECTORY_BYTES,
  MAX_INFLATED_ENTRY_BYTES,
  MAX_MANIFEST_BYTES,
  MAX_SIGNING_BLOCK_BYTES,
  PROOF_OF_ROTATION_ATTRIBUTE_ID,
  V2_BLOCK_ID,
  V3_BLOCK_ID,
  V31_BLOCK_ID,
  type ApkParseStats,
  type ApkSigner,
  type ApkSignerScheme,
  type CentralDirectoryEntry,
  type CountingRandomAccessSource,
  type EocdInfo,
  type ParsedApk,
  type ParsedManifest,
  type RandomAccessSource,
  type VirtualPatch,
} from './apk/index.js';

export {
  extractV1Signers,
  parseV1Signature,
  combineSigners,
  MAX_V1_SIGNATURE_BYTES,
  type V1Signer,
  type CombinedSigner,
  type CombinedSigners,
} from './apk/index.js';

export {
  en,
  getGuidance,
  t,
  type Guidance,
  type GuidanceContext,
  type GuidanceKey,
  type GuidanceLink,
  type GuidanceOrigin,
  type GuidanceParams,
} from './guidance/index.js';
