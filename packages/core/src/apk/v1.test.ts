import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseDer, readInteger, readSequence } from './der.js';
import { buildApk } from './build-apk-test-helper.js';
import { ApkParseError, createBufferSource } from './source.js';
import { extractV1Signers, MAX_V1_SIGNATURE_BYTES, parseV1Signature } from './v1.js';

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(
    await readFile(new URL(`../../../../fixtures/v1/${name}`, import.meta.url)),
  );
}

describe('APK v1/JAR signatures', () => {
  it('extracts a single certificate from META-INF/CERT.RSA', async () => {
    const payload = await fixture('CERT.RSA');
    const certificate = await fixture('single-cert.der');
    const apk = await buildApk({
      entries: [{ name: 'META-INF/CERT.RSA', data: payload }],
    });

    const [signer] = await extractV1Signers(createBufferSource(apk));
    expect(signer?.scheme).toBe('v1');
    expect(signer?.certificates).toHaveLength(1);
    expect(signer?.certificates[0]).toEqual(certificate);
  });

  it('matches the leaf certificate in a chain and puts it first', async () => {
    const payload = await fixture('CERT-chain.RSA');
    const leaf = await fixture('chain-leaf.der');
    const intermediate = await fixture('chain-intermediate.der');
    const apk = await buildApk({
      entries: [{ name: 'meta-inf/MYKEY.rSa', data: payload }],
    });

    const [signer] = await extractV1Signers(createBufferSource(apk));
    expect(signer?.certificates).toHaveLength(2);
    expect(signer?.certificates[0]).toEqual(leaf);
    expect(signer?.certificates[1]).toEqual(intermediate);
  });

  it('falls back to the first certificate when signer identity does not match', async () => {
    const payload = await fixture('CERT-chain.RSA');
    const intermediate = await fixture('chain-intermediate.der');
    const leaf = await fixture('chain-leaf.der');
    const serial = extractSerial(leaf);
    const patched = new Uint8Array(payload);
    const positions = findAll(patched, serial);
    const last = positions.at(-1);

    expect(last).toBeDefined();
    if (last !== undefined) {
      const replacement = new Uint8Array(serial.byteLength);
      replacement[0] = 1;
      patched.set(replacement, last);
    }

    const parsed = parseV1Signature(patched);
    expect(parsed.certificates[0]).toEqual(intermediate);
  });

  it('rejects garbage and truncation', async () => {
    const payload = await fixture('CERT.RSA');
    expect(() => parseV1Signature(new Uint8Array([1, 2, 3]))).toThrowError(ApkParseError);
    expect(() => parseV1Signature(payload.slice(0, payload.byteLength - 1))).toThrowError(
      ApkParseError,
    );
  });

  it('rejects a signature file over 1 MiB before parsing', () => {
    expect(() => parseV1Signature(new Uint8Array(MAX_V1_SIGNATURE_BYTES + 1))).toThrowError(
      expect.objectContaining({ code: 'APK_V1_SIGNATURE_LIMIT' }),
    );
  });

  it('ignores non-signature META-INF files and supports RSA, DSA, and EC suffixes', async () => {
    const payload = await fixture('CERT.RSA');
    const apk = await buildApk({
      entries: [
        { name: 'META-INF/CERT.RSA', data: payload },
        { name: 'META-INF/IGNORED.SF', data: new Uint8Array([1]) },
        { name: 'META-INF/COPY.EC', data: payload },
        { name: 'META-INF/OTHER.DSA', data: payload },
      ],
    });

    await expect(extractV1Signers(createBufferSource(apk))).resolves.toHaveLength(3);
  });
});

function findAll(bytes: Uint8Array, needle: Uint8Array): number[] {
  const positions: number[] = [];
  for (let index = 0; index <= bytes.byteLength - needle.byteLength; index += 1) {
    if (bytesEqual(bytes.subarray(index, index + needle.byteLength), needle)) {
      positions.push(index);
    }
  }
  return positions;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return false;
  }
  return true;
}

function extractSerial(certificate: Uint8Array): Uint8Array {
  const parsed = parseDer(certificate);
  const certificateFields = readSequence(parsed);
  const tbs = certificateFields[0];
  if (tbs === undefined) throw new Error('missing TBS');
  const fields = readSequence(tbs);
  const version = fields[0];
  const serialIndex = version !== undefined && version.tagClass === 2 ? 1 : 0;
  return readInteger(fields[serialIndex] ?? parsed).slice();
}
