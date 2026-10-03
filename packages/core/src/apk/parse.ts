import { combineSigners } from './signers.js';
import { extractApkSigners } from './signing-block.js';
import {
  createCountingSource,
  ApkParseError,
  type RandomAccessSource,
} from './source.js';
import { findEocd, readCentralDirectory, readEntry, type EocdInfo } from './zip.js';
import { extractV1Signers } from './v1.js';
import { MAX_MANIFEST_BYTES, parseBinaryXml, type ParsedManifest } from './axml.js';

export interface ApkParseStats {
  readonly bytesRead: number;
  readonly reads: number;
}

export interface ParsedApk {
  readonly packageName: string;
  readonly versionCode?: number;
  readonly versionName?: string;
  readonly minSdk?: number;
  readonly targetSdk?: number;
  readonly signers: readonly {
    readonly fingerprint: string;
    readonly schemes: string[];
    readonly isCurrent: boolean;
  }[];
  readonly signersDisagree: boolean;
  readonly hasRotationLineage: boolean;
  readonly warnings: readonly string[];
  readonly stats: ApkParseStats;
}

function manifestError(message: string): ApkParseError {
  return new ApkParseError('MANIFEST_INVALID', message);
}

function notZipError(): ApkParseError {
  return new ApkParseError('NOT_A_ZIP', 'Input is not a valid ZIP/APK archive.');
}

function metadataFields(
  manifest: ParsedManifest,
): Omit<ParsedApk, 'signers' | 'signersDisagree' | 'hasRotationLineage' | 'warnings' | 'stats'> {
  return {
    packageName: manifest.packageName,
    ...(manifest.versionCode === undefined ? {} : { versionCode: manifest.versionCode }),
    ...(manifest.versionName === undefined ? {} : { versionName: manifest.versionName }),
    ...(manifest.minSdk === undefined ? {} : { minSdk: manifest.minSdk }),
    ...(manifest.targetSdk === undefined ? {} : { targetSdk: manifest.targetSdk }),
  };
}

/**
 * Parses an APK with bounded random-access reads. It extracts declared signer
 * certificates but does not verify signatures, digests, or certificate chains.
 */
export async function parseApk(source: RandomAccessSource): Promise<ParsedApk> {
  const counted = createCountingSource(source);
  let eocd: EocdInfo;
  let entries: Awaited<ReturnType<typeof readCentralDirectory>>;
  try {
    eocd = await findEocd(counted);
    entries = await readCentralDirectory(counted, eocd);
  } catch {
    throw notZipError();
  }

  const manifest = entries.find((entry) => entry.name === 'AndroidManifest.xml');
  if (manifest === undefined) {
    throw new ApkParseError('NO_MANIFEST', 'AndroidManifest.xml is missing.');
  }
  if (manifest.uncompressedSize > MAX_MANIFEST_BYTES) {
    throw manifestError('Android manifest exceeds 8 MiB.');
  }

  let manifestBytes: Uint8Array;
  try {
    manifestBytes = await readEntry(counted, manifest.name, eocd, entries);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Android manifest could not be read.';
    throw manifestError(message);
  }

  let metadata: ParsedManifest;
  try {
    metadata = parseBinaryXml(manifestBytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Android binary XML is invalid.';
    throw manifestError(message);
  }

  const v2v3 = await extractApkSigners(counted);
  const v1 = await extractV1Signers(counted, eocd, entries);
  const combined = await combineSigners(v2v3, v1);
  const warnings = [...combined.warnings];
  if (combined.signers.length === 0) {
    warnings.push('No recognized APK signer certificate was found.');
  }

  return {
    ...metadataFields(metadata),
    signers: combined.signers,
    signersDisagree: combined.signersDisagree,
    hasRotationLineage: v2v3.some((signer) => signer.hasRotationLineage),
    warnings,
    stats: {
      bytesRead: counted.bytesRead,
      reads: counted.readCalls,
    },
  };
}
