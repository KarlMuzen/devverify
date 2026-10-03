import { sha256Hex } from '../fingerprint.js';
import { ApkParseError } from './source.js';
import {
  MAX_CERTIFICATE_BYTES,
  MAX_CERTIFICATES,
  MAX_SIGNERS,
} from './signing-limits.js';
import {
  PROOF_OF_ROTATION_ATTRIBUTE_ID,
  type ApkSigner,
  type ApkSignerScheme,
} from './signing-block.js';
import { Cursor, readId } from './signing-cursor.js';

export function parseSchemeValue(
  value: Uint8Array,
  scheme: ApkSignerScheme,
): Promise<ApkSigner[]> {
  const outer = new Cursor(value);
  const signersContainer = outer.lp('APK_SIGNERS_INVALID');
  if (outer.remaining !== 0) {
    throw new ApkParseError('APK_SIGNERS_TRAILING', 'APK signer block contains trailing bytes.');
  }

  const signers = new Cursor(signersContainer);
  const parsed: Array<Omit<ApkSigner, 'fingerprint'>> = [];

  while (signers.remaining > 0) {
    if (parsed.length >= MAX_SIGNERS) {
      throw new ApkParseError('APK_SIGNER_LIMIT', 'APK signing block contains too many signers.');
    }
    parsed.push(parseSigner(signers.lp('APK_SIGNER_INVALID'), scheme));
  }

  return addFingerprints(parsed);
}

function parseSigner(bytes: Uint8Array, scheme: ApkSignerScheme): Omit<ApkSigner, 'fingerprint'> {
  const cursor = new Cursor(bytes);
  const signedData = cursor.lp('APK_SIGNER_INVALID');
  const parsed = parseSignedData(signedData, scheme);

  if (scheme !== 'v2') {
    const minSdk = cursor.u32();
    const maxSdk = cursor.u32();
    if (minSdk !== parsed.minSdk || maxSdk !== parsed.maxSdk) {
      throw new ApkParseError(
        'APK_SDK_RANGE_MISMATCH',
        'APK signer SDK range does not match its signed data.',
      );
    }
  }

  parseSignatureSequence(cursor.lp('APK_SIGNATURES_INVALID'));
  void cursor.lp('APK_PUBLIC_KEY_INVALID');

  if (cursor.remaining !== 0) {
    throw new ApkParseError('APK_SIGNER_TRAILING', 'APK signer contains trailing bytes.');
  }

  return parsed;
}

function parseSignedData(
  bytes: Uint8Array,
  scheme: ApkSignerScheme,
): Omit<ApkSigner, 'fingerprint'> {
  const cursor = new Cursor(bytes);
  parseDigestSequence(cursor.lp('APK_SIGNED_DATA_INVALID'));
  const certificates = parseCertificates(cursor.lp('APK_CERTIFICATE_INVALID'));

  if (certificates.length === 0) {
    throw new ApkParseError('APK_CERTIFICATE_MISSING', 'APK signer has no certificates.');
  }

  let minSdk: number | undefined;
  let maxSdk: number | undefined;
  if (scheme !== 'v2') {
    minSdk = cursor.u32();
    maxSdk = cursor.u32();
  }

  const hasRotationLineage = parseAdditionalAttributes(cursor.lp('APK_ATTRIBUTE_INVALID'));
  if (cursor.remaining !== 0) {
    throw new ApkParseError('APK_SIGNED_DATA_TRAILING', 'APK signed data contains trailing bytes.');
  }

  return {
    scheme,
    certificates,
    ...(minSdk === undefined ? {} : { minSdk }),
    ...(maxSdk === undefined ? {} : { maxSdk }),
    hasRotationLineage,
  };
}

function parseDigestSequence(bytes: Uint8Array): void {
  const cursor = new Cursor(bytes);
  while (cursor.remaining > 0) {
    const digest = cursor.lp('APK_V2_DIGEST_INVALID');
    if (digest.byteLength < 4) {
      throw new ApkParseError('APK_V2_DIGEST_INVALID', 'APK digest record is too short.');
    }
    const item = new Cursor(digest);
    item.u32();
    void item.lp('APK_V2_DIGEST_INVALID');
    if (item.remaining !== 0) {
      throw new ApkParseError('APK_V2_DIGEST_INVALID', 'APK digest record has trailing bytes.');
    }
  }
}

function parseSignatureSequence(bytes: Uint8Array): void {
  const cursor = new Cursor(bytes);
  while (cursor.remaining > 0) {
    const signature = cursor.lp('APK_SIGNATURE_INVALID');
    if (signature.byteLength < 4) {
      throw new ApkParseError('APK_SIGNATURE_INVALID', 'APK signature record is too short.');
    }
    const item = new Cursor(signature);
    item.u32();
    void item.lp('APK_SIGNATURE_INVALID');
    if (item.remaining !== 0) {
      throw new ApkParseError('APK_SIGNATURE_INVALID', 'APK signature record has trailing bytes.');
    }
  }
}

function parseCertificates(bytes: Uint8Array): Uint8Array[] {
  const cursor = new Cursor(bytes);
  const certificates: Uint8Array[] = [];
  while (cursor.remaining > 0) {
    if (certificates.length >= MAX_CERTIFICATES) {
      throw new ApkParseError('APK_CERTIFICATE_LIMIT', 'APK signer contains too many certificates.');
    }
    const certificate = cursor.lp('APK_CERTIFICATE_INVALID');
    if (certificate.byteLength === 0 || certificate.byteLength > MAX_CERTIFICATE_BYTES) {
      throw new ApkParseError('APK_CERTIFICATE_INVALID', 'APK certificate has an invalid size.');
    }
    certificates.push(certificate);
  }
  return certificates;
}

function parseAdditionalAttributes(bytes: Uint8Array): boolean {
  const cursor = new Cursor(bytes);
  while (cursor.remaining > 0) {
    const attribute = cursor.lp('APK_ATTRIBUTE_INVALID');
    if (attribute.byteLength < 4) {
      throw new ApkParseError('APK_ATTRIBUTE_INVALID', 'APK additional attribute is too short.');
    }
    if (readId(attribute) === PROOF_OF_ROTATION_ATTRIBUTE_ID) {
      return true;
    }
  }
  return false;
}

async function addFingerprints(
  signers: Array<Omit<ApkSigner, 'fingerprint'>>,
): Promise<ApkSigner[]> {
  return Promise.all(
    signers.map(async (signer) => {
      const [certificate] = signer.certificates;
      if (certificate === undefined) {
        throw new ApkParseError('APK_CERTIFICATE_MISSING', 'APK signer has no signer certificate.');
      }
      return {
        ...signer,
        fingerprint: await sha256Hex(certificate),
      };
    }),
  );
}
