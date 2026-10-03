import type { ApiState, AppStatus } from './types.js';

export interface FingerprintStatusResult {
  fingerprint: string;
  state: ApiState;
}

/**
 * Derives one public application status from checked fingerprints.
 */
export function deriveAppStatus(
  results: FingerprintStatusResult[],
): AppStatus {
  if (results.some((result) => result.state === 'REGISTERED')) {
    return 'registered';
  }
  if (
    results.some(
      (result) =>
        result.state === 'REGISTERED_WITH_ANOTHER_CERTIFICATE_FINGERPRINT',
    )
  ) {
    return 'registered_other_key';
  }
  if (results.some((result) => result.state === 'NOT_REGISTERED')) {
    return 'not_registered';
  }
  return 'unknown';
}
