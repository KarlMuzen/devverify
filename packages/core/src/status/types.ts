export type ApiState =
  | 'REGISTERED'
  | 'NOT_REGISTERED'
  | 'REGISTERED_WITH_ANOTHER_CERTIFICATE_FINGERPRINT'
  | 'UNKNOWN';

export type AppStatus =
  | 'registered'
  | 'registered_other_key'
  | 'not_registered'
  | 'unknown';

/**
 * Maps a raw API state to the stable internal state union.
 */
export function mapApiState(raw: string): ApiState {
  switch (raw) {
    case 'REGISTERED':
      return 'REGISTERED';
    case 'NOT_REGISTERED':
      return 'NOT_REGISTERED';
    case 'REGISTERED_WITH_ANOTHER_CERTIFICATE_FINGERPRINT':
      return 'REGISTERED_WITH_ANOTHER_CERTIFICATE_FINGERPRINT';
    default:
      return 'UNKNOWN';
  }
}
