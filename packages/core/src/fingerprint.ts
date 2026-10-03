import { DevVerifyError } from './errors.js';

const HEX = /^[0-9a-fA-F]+$/;
const FINGERPRINT_LENGTH = 64;

export type FingerprintFormat = 'hex' | 'colon-upper';

export class FingerprintError extends DevVerifyError {
  public constructor(message = 'Invalid fingerprint.') {
    super('INVALID_FINGERPRINT', message);
    this.name = 'FingerprintError';
  }
}

/**
 * Normalizes a SHA-256 certificate fingerprint to lowercase hexadecimal.
 */
export function normalizeFingerprint(input: string): string {
  const compact = input.replaceAll(':', '');
  if (
    compact.length !== FINGERPRINT_LENGTH ||
    !HEX.test(compact)
  ) {
    throw new FingerprintError(`Invalid fingerprint: ${input}`);
  }
  return compact.toLowerCase();
}

/**
 * Formats a normalized fingerprint for display.
 */
export function formatFingerprint(
  fingerprint: string,
  format: FingerprintFormat,
): string {
  const normalized = normalizeFingerprint(fingerprint);
  if (format === 'hex') {
    return normalized;
  }

  return normalized.match(/../g)?.join(':').toUpperCase() ?? normalized.toUpperCase();
}

/**
 * Computes the SHA-256 digest as lowercase hexadecimal.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input.buffer);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  );
  return hex.join('');
}

/**
 * Compares two fingerprint strings after normalization.
 */
export function equalFingerprints(a: string, b: string): boolean {
  return normalizeFingerprint(a) === normalizeFingerprint(b);
}
