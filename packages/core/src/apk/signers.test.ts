import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../fingerprint.js';
import { combineSigners } from './signers.js';
import type { V1Signer } from './v1.js';

async function cert(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(new URL(`../../../../fixtures/certs/${name}.der`, import.meta.url)));
}

function v1(certificate: Uint8Array): V1Signer {
  return { scheme: 'v1', certificates: [certificate] };
}

describe('combined signer identities', () => {
  it('uses the v2/v3 signer as current when v1 differs', async () => {
    const v2 = await cert('v2');
    const v1Signer = v1(await cert('v3'));
    const [v2Fingerprint, v1Fingerprint] = await Promise.all([
      sha256Hex(v2),
      sha256Hex(v1Signer.certificates[0] ?? new Uint8Array()),
    ]);
    const result = await combineSigners(
      [{
        scheme: 'v2',
        certificates: [v2],
        fingerprint: v2Fingerprint,
        hasRotationLineage: false,
      }],
      [v1Signer],
    );

    const current = result.signers.find((signer) => signer.fingerprint === v2Fingerprint);
    const legacy = result.signers.find((signer) => signer.fingerprint === v1Fingerprint);
    expect(current?.isCurrent).toBe(true);
    expect(legacy?.isCurrent).toBe(false);
    expect(result.signersDisagree).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  it('merges the same certificate across v1 and v3', async () => {
    const certificate = await cert('v2');
    const fingerprint = await sha256Hex(certificate);
    const result = await combineSigners(
      [{
        scheme: 'v3',
        certificates: [certificate],
        fingerprint,
        minSdk: 24,
        maxSdk: 35,
        hasRotationLineage: false,
      }],
      [v1(certificate)],
    );

    expect(result.signers).toEqual([
      { fingerprint, schemes: ['v1', 'v3'], isCurrent: true },
    ]);
    expect(result.signersDisagree).toBe(false);
  });

  it('keeps a v1-only signer current', async () => {
    const certificate = await cert('v2');
    const fingerprint = await sha256Hex(certificate);
    await expect(combineSigners([], [v1(certificate)])).resolves.toEqual({
      signers: [{ fingerprint, schemes: ['v1'], isCurrent: true }],
      signersDisagree: false,
      warnings: [],
    });
  });
});
