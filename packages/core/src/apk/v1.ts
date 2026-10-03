import { readCentralDirectory, type CentralDirectoryEntry } from './central-directory.js';
import { parseDer, readContextSpecific, readInteger, readOid, readSequence, readSet, isContextSpecific, type DerNode } from './der.js';
import { readEntry } from './entry.js';
import type { EocdInfo } from './eocd.js';
import { ApkParseError, type RandomAccessSource } from './source.js';

export const MAX_V1_SIGNATURE_BYTES = 1 * 1024 * 1024;

export interface V1Signer {
  readonly scheme: 'v1';
  readonly certificates: readonly Uint8Array[];
}

interface CertificateIdentity {
  readonly issuer: Uint8Array;
  readonly serial: Uint8Array;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return false;
  }
  return true;
}

function certificateIdentity(node: DerNode): CertificateIdentity {
  const certificate = readSequence(node, 'APK_V1_CERTIFICATE_INVALID');
  const tbs = certificate[0];
  if (tbs === undefined) {
    throw new ApkParseError('APK_V1_CERTIFICATE_INVALID', 'X.509 certificate is missing its TBS portion.');
  }

  const fields = readSequence(tbs, 'APK_V1_CERTIFICATE_INVALID');
  let index = 0;
  const firstField = fields[0];
  if (firstField !== undefined && isContextSpecific(firstField, 0, true)) {
    index = 1;
  }

  const serialNode = fields[index];
  const issuerNode = fields[index + 2];
  if (serialNode === undefined || issuerNode === undefined) {
    throw new ApkParseError('APK_V1_CERTIFICATE_INVALID', 'X.509 certificate identity fields are incomplete.');
  }

  return {
    serial: readInteger(serialNode, 'APK_V1_CERTIFICATE_SERIAL'),
    issuer: issuerNode.encoded,
  };
}

function signerIdentity(node: DerNode): CertificateIdentity | undefined {
  const fields = readSequence(node, 'APK_V1_SIGNER_INFO_INVALID');
  const sid = fields[1];
  if (sid === undefined || sid.tagClass !== 0 || sid.tagNumber !== 16 || !sid.constructed) {
    return undefined;
  }

  const identity = readSequence(sid, 'APK_V1_SIGNER_ID_INVALID');
  const issuer = identity[0];
  const serial = identity[1];
  if (issuer === undefined || serial === undefined) return undefined;

  return {
    issuer: issuer.encoded,
    serial: readInteger(serial, 'APK_V1_SIGNER_SERIAL'),
  };
}

function parseCertificateSet(node: DerNode): DerNode[] {
  const result: DerNode[] = [];
  for (const child of readContextSpecific(node, 0, 'APK_V1_CERTIFICATE_SET')) {
    if (child.tagClass === 0 && child.tagNumber === 16 && child.constructed) {
      result.push(child);
    }
  }
  if (result.length === 0) {
    throw new ApkParseError('APK_V1_CERTIFICATE_MISSING', 'PKCS#7 SignedData contains no X.509 certificates.');
  }
  return result;
}

function parseSignedData(bytes: Uint8Array): readonly Uint8Array[] {
  const root = parseDer(bytes);
  const contentInfo = readSequence(root, 'APK_V1_PKCS7_INVALID');
  const contentType = contentInfo[0];
  const content = contentInfo[1];
  if (contentType === undefined || content === undefined) {
    throw new ApkParseError('APK_V1_PKCS7_INVALID', 'PKCS#7 ContentInfo is incomplete.');
  }
  if (readOid(contentType, 'APK_V1_PKCS7_OID') !== '1.2.840.113549.1.7.2') {
    throw new ApkParseError('APK_V1_PKCS7_TYPE', 'V1 signature is not PKCS#7 SignedData.');
  }

  const signedDataChildren = readContextSpecific(content, 0, 'APK_V1_PKCS7_CONTENT');
  const signedData = signedDataChildren[0];
  if (signedData === undefined || signedDataChildren.length !== 1) {
    throw new ApkParseError('APK_V1_PKCS7_CONTENT', 'PKCS#7 SignedData content is malformed.');
  }

  const fields = readSequence(signedData, 'APK_V1_SIGNED_DATA');
  if (fields.length < 4) {
    throw new ApkParseError('APK_V1_SIGNED_DATA', 'PKCS#7 SignedData is incomplete.');
  }

  const certificateSet = fields.find((field) => isContextSpecific(field, 0, true));
  if (certificateSet === undefined) {
    throw new ApkParseError('APK_V1_CERTIFICATE_MISSING', 'PKCS#7 SignedData has no certificate set.');
  }

  const signerInfos = fields[fields.length - 1];
  if (signerInfos === undefined) {
    throw new ApkParseError('APK_V1_SIGNER_INFO_MISSING', 'PKCS#7 SignedData has no signer infos.');
  }

  const certificates = parseCertificateSet(certificateSet);
  const identities = certificates.map(certificateIdentity);
  const signers = readSet(signerInfos, 'APK_V1_SIGNER_INFOS');

  let selected = -1;
  for (const signer of signers) {
    const identity = signerIdentity(signer);
    if (identity === undefined) continue;
    selected = identities.findIndex(
      (candidate) =>
        sameBytes(candidate.serial, identity.serial) &&
        sameBytes(candidate.issuer, identity.issuer),
    );
    if (selected >= 0) break;
  }

  if (selected <= 0) {
    return certificates.map((certificate) => certificate.encoded);
  }

  const selectedCertificate = certificates[selected];
  if (selectedCertificate === undefined) {
    throw new ApkParseError('APK_V1_CERTIFICATE_INVALID', 'Selected signer certificate is unavailable.');
  }

  return [
    selectedCertificate,
    ...certificates.slice(0, selected),
    ...certificates.slice(selected + 1),
  ].map((certificate) => certificate.encoded);
}

/**
 * Parses one META-INF/*.RSA, *.DSA, or *.EC PKCS#7 signature file.
 */
export function parseV1Signature(bytes: Uint8Array): V1Signer {
  if (bytes.byteLength > MAX_V1_SIGNATURE_BYTES) {
    throw new ApkParseError('APK_V1_SIGNATURE_LIMIT', 'V1 signature file exceeds 1 MiB.');
  }
  return {
    scheme: 'v1',
    certificates: parseSignedData(bytes),
  };
}

function isV1SignatureFile(name: string): boolean {
  return /^META-INF\/[^/]+\.(?:RSA|DSA|EC)$/i.test(name);
}

/**
 * Finds v1/JAR signature files and extracts their declared certificate chains.
 */
export async function extractV1Signers(
  source: RandomAccessSource,
  eocd?: EocdInfo,
  entries?: readonly CentralDirectoryEntry[],
): Promise<V1Signer[]> {
  const directory = entries ?? (await readCentralDirectory(source, eocd));
  const result: V1Signer[] = [];

  for (const entry of directory.filter((candidate) => isV1SignatureFile(candidate.name))) {
    if (
      entry.compressedSize > MAX_V1_SIGNATURE_BYTES ||
      entry.uncompressedSize > MAX_V1_SIGNATURE_BYTES
    ) {
      throw new ApkParseError('APK_V1_SIGNATURE_LIMIT', 'V1 signature file exceeds 1 MiB.');
    }
    result.push(parseV1Signature(await readEntry(source, entry.name, eocd, directory)));
  }

  return result;
}
