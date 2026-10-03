import { readFile } from 'node:fs/promises';
import { parseDer, readInteger, readSequence } from './der.js';

export async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(
    await readFile(new URL(`../../../../fixtures/v1/${name}`, import.meta.url)),
  );
}

export function tlv(tag: number, value: Uint8Array): Uint8Array {
  const length = encodeLength(value.byteLength);
  const result = new Uint8Array(1 + length.byteLength + value.byteLength);
  result[0] = tag;
  result.set(length, 1);
  result.set(value, 1 + length.byteLength);
  return result;
}

export function sequence(...values: readonly Uint8Array[]): Uint8Array {
  return tlv(0x30, concat(values));
}

export function setOf(...values: readonly Uint8Array[]): Uint8Array {
  return tlv(0x31, concat(values));
}

export function integer(value: Uint8Array): Uint8Array {
  return tlv(0x02, value);
}

export function oid(bytes: string): Uint8Array {
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

export function pkcs7(
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
