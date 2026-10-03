import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildApk } from './build-apk-test-helper.js';
import { parseDer, readInteger, readSequence } from './der.js';
import { ApkParseError, createBufferSource } from './source.js';
import {
  extractV1Signers,
  MAX_V1_SIGNATURE_BYTES,
  parseV1Signature,
} from './v1.js';

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(
    await readFile(new URL(`../../../../fixtures/v1/${name}`, import.meta.url)),
  );
}

function tlv(tag: number, value: Uint8Array): Uint8Array {
  const length = encodeLength(value.byteLength);
  const result = new Uint8Array(1 + length.byteLength + value.byteLength);
  result[0] = tag;
  result.set(length, 1);
  result.set(value, 1 + length.byteLength);
  return result;
}

function sequence(...values: readonly Uint8Array[]): Uint8Array {
  return tlv(0x30, concat(values));
}

function setOf(...values: readonly Uint8Array[]): Uint8Array {
  return tlv(0x31, concat(values));
}

function integer(value: Uint8Array): Uint8Array {
  return tlv(0x02, value);
}

function oid(bytes: string): Uint8Array {
  return tlv(
    0x06,
    Uint8Array.from(
      bytes.match(/../g)?.map((pair) => Number.parseInt(pair, 16)) ?? [],
    ),
  );
}

function concat(values: readonly Uint8Array[]): Uint8Array {
  const length = values.reduce((total, value) => total + value.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.byteLength;
  }
  return result;
}

function encodeLength(length: number): Uint8Array {
  if (length < 128) return new Uint8Array([length]);

  const octets: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    octets.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
  return new Uint8Array([0x80 | octets.length, ...octets]);
}

function signerIdentity(
  certificate: Uint8Array,
  serialOverride?: Uint8Array,
): Uint8Array {
  const certificateFields = readSequence(parseDer(certificate));
  const tbs = certificateFields[0];
  if (tbs === undefined) throw new Error('missing TBS');

  const fields = readSequence(tbs);
  const version = fields[0];
  const serialIndex = version !== undefined && version.tagClass === 2 ? 1 : 0;
  const issuer = fields[serialIndex + 2];
  const serial = fields[serialIndex];
  if (issuer === undefined || serial === undefined) {
    throw new Error('incomplete TBS');
  }

  return sequence(
    issuer.encoded,
    integer(serialOverride ?? readInteger(serial).slice()),
  );
}

function pkcs7(
  certificateSet: readonly Uint8Array[],
  signerCertificate = 0,
  serialOverride?: Uint8Array,
): Uint8Array {
  const certificates = tlv(0xa0, concat(certificateSet));
  const selectedCertificate =
    certificateSet[signerCertificate] ?? certificateSet[0] ?? new Uint8Array();

  const signerInfo = sequence(
    integer(new Uint8Array([1])),
    signerIdentity(selectedCertificate, serialOverride),
    sequence(),
    tlv(0x04, new Uint8Array()),
  );

  const signedData = sequence(
    integer(new Uint8Array([1])),
    setOf(),
    sequence(oid('2a864886f70d010701')),
    certificates,
    setOf(signerInfo),
  );

  return sequence(
    oid('2a864886f70d010702'),
    tlv(0xa0, signedData),
  );
}

describe('APK v1/JAR signatures', () => {
  it('extracts a single certificate from META-INF/CERT.RSA', async () => {
    const certificate = await fixture('chain-leaf.der');
    const payload = pkcs7([certificate]);
    const apk = await buildApk({
      entries: [{ name: 'META-INF/CERT.RSA', data: payload }],
    });

    const [signer] = await extractV1Signers(createBufferSource(apk));
    expect(signer?.scheme).toBe('v1');
    expect(signer?.certificates).toEqual([certificate]);
  });

  it('matches the leaf certificate in a chain and puts it first', async () => {
    const intermediate = await fixture('chain-intermediate.der');
    const leaf = await fixture('chain-leaf.der');
    const apk = await buildApk({
      entries: [{
        name: 'meta-inf/MYKEY.rSa',
        data: pkcs7([intermediate, leaf], 1),
      }],
    });

    const [signer] = await extractV1Signers(createBufferSource(apk));
    expect(signer?.certificates).toEqual([leaf, intermediate]);
  });

  it('falls back to the first certificate when signer identity does not match', async () => {
    const intermediate = await fixture('chain-intermediate.der');
    const leaf = await fixture('chain-leaf.der');
    const payload = pkcs7(
      [intermediate, leaf],
      1,
      new Uint8Array([1]),
    );

    const signer = parseV1Signature(payload);
    expect(signer.certificates[0]).toEqual(intermediate);
    expect(signer.certificates[1]).toEqual(leaf);
  });

  it('rejects garbage and truncation', async () => {
    const certificate = await fixture('chain-leaf.der');
    const payload = pkcs7([certificate]);
    expect(() => parseV1Signature(new Uint8Array([1, 2, 3]))).toThrowError(ApkParseError);
    expect(() => parseV1Signature(payload.slice(0, payload.byteLength - 1))).toThrowError(
      ApkParseError,
    );
  });

  it('rejects a signature file over 1 MiB before parsing', () => {
    expectErrorCode(
      () => parseV1Signature(new Uint8Array(MAX_V1_SIGNATURE_BYTES + 1)),
      'APK_V1_SIGNATURE_LIMIT',
    );
  });

  it('rejects malformed PKCS#7 structures before certificate matching', async () => {
    const certificate = await fixture('chain-leaf.der');
    const certificateSet = tlv(0xa0, certificate);
    const makeSignedData = (...fields: readonly Uint8Array[]): Uint8Array =>
      sequence(
        integer(new Uint8Array([1])),
        setOf(),
        sequence(oid('2a864886f70d010701')),
        ...fields,
      );

    expectErrorCode(
      () => parseV1Signature(
        sequence(oid('2a864886f70d010701'), tlv(0xa0, sequence())),
      ),
      'APK_V1_PKCS7_TYPE',
    );

    expectErrorCode(
      () => parseV1Signature(sequence(oid('2a864886f70d010702'))),
      'APK_V1_PKCS7_INVALID',
    );

    expectErrorCode(
      () => parseV1Signature(
        sequence(oid('2a864886f70d010702'), tlv(0xa0, new Uint8Array())),
      ),
      'APK_V1_PKCS7_CONTENT',
    );

    expectErrorCode(
      () => parseV1Signature(
        sequence(
          oid('2a864886f70d010702'),
          tlv(0xa0, makeSignedData()),
        ),
      ),
      'APK_V1_SIGNED_DATA',
    );

    expectErrorCode(
      () => parseV1Signature(
        sequence(
          oid('2a864886f70d010702'),
          tlv(0xa0, makeSignedData(setOf())),
        ),
      ),
      'APK_V1_CERTIFICATE_MISSING',
    );

    expectErrorCode(
      () => parseV1Signature(
        sequence(
          oid('2a864886f70d010702'),
          tlv(0xa0, makeSignedData(tlv(0xa0, new Uint8Array()), setOf())),
        ),
      ),
      'APK_V1_CERTIFICATE_MISSING',
    );

    expectErrorCode(
      () => parseV1Signature(
        sequence(
          oid('2a864886f70d010702'),
          tlv(0xa0, makeSignedData(certificateSet, sequence())),
        ),
      ),
      'APK_V1_SIGNER_INFOS',
    );

    const signerWithUnexpectedSid = sequence(
      integer(new Uint8Array([1])),
      tlv(0x04, new Uint8Array()),
      sequence(),
      tlv(0x04, new Uint8Array()),
    );
    const signerWithEmptyIdentity = sequence(
      integer(new Uint8Array([1])),
      sequence(),
      sequence(),
      tlv(0x04, new Uint8Array()),
    );

    expect(() =>
      parseV1Signature(
        sequence(
          oid('2a864886f70d010702'),
          tlv(0xa0, makeSignedData(certificateSet, setOf(signerWithUnexpectedSid))),
        ),
      ),
    ).not.toThrow();

    expect(() =>
      parseV1Signature(
        sequence(
          oid('2a864886f70d010702'),
          tlv(0xa0, makeSignedData(certificateSet, setOf(signerWithEmptyIdentity))),
        ),
      ),
    ).not.toThrow();
  });

  it('enforces the v1 entry-size limit before reading the entry', async () => {
    await expect(
      extractV1Signers(
        createBufferSource(new Uint8Array()),
        undefined,
        [{
          name: 'META-INF/CERT.RSA',
          method: 0,
          compressedSize: MAX_V1_SIGNATURE_BYTES + 1,
          uncompressedSize: 1,
          localHeaderOffset: 0,
        }],
      ),
    ).rejects.toThrowError(ApkParseError);
  });

  it('ignores non-signature META-INF files and supports RSA, DSA, and EC suffixes', async () => {
    const certificate = await fixture('chain-leaf.der');
    const payload = pkcs7([certificate]);
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

function expectErrorCode(action: () => unknown, code: string): void {
  let caught = false;
  try {
    action();
  } catch (error) {
    caught = true;
    expect(error).toBeInstanceOf(ApkParseError);
    if (error instanceof ApkParseError) {
      expect(error.code).toBe(code);
    }
  }
  if (!caught) throw new Error(`Expected ${code}.`);
}
