import { sha256Hex } from '../fingerprint.js';
import type { ApkSigner } from './signing-block-types.js';
import type { V1Signer } from './v1.js';

const SCHEME_ORDER = ['v1', 'v2', 'v3', 'v3.1'] as const;
type Scheme = (typeof SCHEME_ORDER)[number];

export interface CombinedSigner {
  readonly fingerprint: string;
  readonly schemes: string[];
  readonly isCurrent: boolean;
}

export interface CombinedSigners {
  readonly signers: CombinedSigner[];
  readonly signersDisagree: boolean;
  readonly warnings: string[];
}

function schemeRank(scheme: string): number {
  const index = SCHEME_ORDER.indexOf(scheme as Scheme);
  return index < 0 ? SCHEME_ORDER.length : index;
}

/**
 * Combines v2/v3.x and v1 signer material. It prefers v2/v3.x when present
 * but does not perform cryptographic signature verification.
 */
export async function combineSigners(
  v2v3: readonly ApkSigner[],
  v1: readonly V1Signer[],
): Promise<CombinedSigners> {
  const schemesByFingerprint = new Map<string, Set<string>>();

  const add = async (certificate: Uint8Array, scheme: string): Promise<void> => {
    const fingerprint = await sha256Hex(certificate);
    const schemes = schemesByFingerprint.get(fingerprint) ?? new Set<string>();
    schemes.add(scheme);
    schemesByFingerprint.set(fingerprint, schemes);
  };

  for (const signer of v2v3) {
    const certificate = signer.certificates[0];
    if (certificate !== undefined) await add(certificate, signer.scheme);
  }
  for (const signer of v1) {
    const certificate = signer.certificates[0];
    if (certificate !== undefined) await add(certificate, signer.scheme);
  }

  const hasPreferred = [...schemesByFingerprint.values()].some((schemes) =>
    [...schemes].some((scheme) => scheme !== 'v1'),
  );

  const signers = [...schemesByFingerprint.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fingerprint, schemes]) => ({
      fingerprint,
      schemes: [...schemes].sort((left, right) => schemeRank(left) - schemeRank(right)),
      isCurrent: hasPreferred ? [...schemes].some((scheme) => scheme !== 'v1') : true,
    }));

  const byScheme = new Map<string, Set<string>>();
  for (const [fingerprint, schemes] of schemesByFingerprint) {
    for (const scheme of schemes) {
      const fingerprints = byScheme.get(scheme) ?? new Set<string>();
      fingerprints.add(fingerprint);
      byScheme.set(scheme, fingerprints);
    }
  }

  const schemeEntries = [...byScheme.values()];
  let signersDisagree = false;
  for (let left = 0; left < schemeEntries.length && !signersDisagree; left += 1) {
    const leftFingerprints = schemeEntries[left];
    if (leftFingerprints === undefined) continue;
    for (let right = left + 1; right < schemeEntries.length && !signersDisagree; right += 1) {
      const rightFingerprints = schemeEntries[right];
      if (rightFingerprints === undefined) continue;
      for (const fingerprint of leftFingerprints) {
        if ([...rightFingerprints].some((other) => other !== fingerprint)) {
          signersDisagree = true;
          break;
        }
      }
    }
  }

  return {
    signers,
    signersDisagree,
    warnings: signersDisagree
      ? ['Signer certificates disagree across APK signature schemes.']
      : [],
  };
}
