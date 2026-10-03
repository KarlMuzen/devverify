import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createBufferSource } from './source.js';
import { encodeManifest } from './tests/helpers/axml-encode.js';
import { buildApk } from './build-apk-test-helper.js';
import { parseApk } from './parse.js';

async function certificate(name: string): Promise<Uint8Array> {
  return new Uint8Array(
    await readFile(new URL(`../../../../fixtures/certs/${name}.der`, import.meta.url)),
  );
}

describe('parseApk', () => {
  it('parses metadata, signer state, rotation lineage, warnings, and stats', async () => {
    const apk = await buildApk({
      entries: [{ name: 'AndroidManifest.xml', data: encodeManifest() }],
      signers: [
        {
          scheme: 'v3',
          certificate: await certificate('v3'),
          minSdk: 24,
          maxSdk: 35,
          hasRotationLineage: true,
        },
      ],
    });
    const result = await parseApk(createBufferSource(apk));
    expect(result.packageName).toBe('com.example.test');
    expect(result.versionCode).toBe(42);
    expect(result.versionName).toBe('1.2.3');
    expect(result.minSdk).toBe(24);
    expect(result.targetSdk).toBe(35);
    expect(result.signers[0]?.schemes).toEqual(['v3']);
    expect(result.signers[0]?.isCurrent).toBe(true);
    expect(result.signersDisagree).toBe(false);
    expect(result.hasRotationLineage).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.stats.bytesRead).toBeGreaterThan(0);
    expect(result.stats.reads).toBeGreaterThan(0);
    expect(result.stats.bytesRead).toBeLessThan(4 * 1024 * 1024);
  });

  it('reports a missing signature without failing the APK parse', async () => {
    const apk = await buildApk({
      entries: [{ name: 'AndroidManifest.xml', data: encodeManifest() }],
    });
    const result = await parseApk(createBufferSource(apk));
    expect(result.signers).toEqual([]);
    expect(result.warnings).toContain('No recognized APK signer certificate was found.');
  });

  it('parses a deflated manifest and tolerates missing optional SDK data', async () => {
    const apk = await buildApk({
      entries: [
        {
          name: 'AndroidManifest.xml',
          data: encodeManifest({ includeSdk: false }),
          method: 8,
        },
      ],
    });
    const result = await parseApk(createBufferSource(apk));
    expect(result.packageName).toBe('com.example.test');
    expect(result.minSdk).toBeUndefined();
  });

  it('maps missing manifest and invalid ZIP to stable public error codes', async () => {
    const noManifest = await buildApk({
      entries: [{ name: 'classes.dex', data: new Uint8Array([1]) }],
    });
    await expect(parseApk(createBufferSource(noManifest))).rejects.toMatchObject({ code: 'NO_MANIFEST' });
    await expect(parseApk(createBufferSource(new Uint8Array([1, 2, 3]))))
      .rejects.toMatchObject({ code: 'NOT_A_ZIP' });
  });

  it('maps malformed manifest to MANIFEST_INVALID', async () => {
    const apk = await buildApk({
      entries: [{ name: 'AndroidManifest.xml', data: new Uint8Array([1, 2, 3]) }],
    });
    await expect(parseApk(createBufferSource(apk)))
      .rejects.toMatchObject({ code: 'MANIFEST_INVALID' });
  });

  it('enforces the 8 MiB manifest cap from central-directory metadata', async () => {
    const apk = await buildApk({
      entries: [{
        name: 'AndroidManifest.xml',
        data: new Uint8Array(8 * 1024 * 1024 + 1),
      }],
    });
    await expect(parseApk(createBufferSource(apk)))
      .rejects.toMatchObject({ code: 'MANIFEST_INVALID' });
  });
});
