#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_OUT="$ROOT/fixtures/certs"
V1_OUT="$ROOT/fixtures/v1"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to regenerate APK fixtures." >&2
  exit 1
fi

mkdir -p "$CERT_OUT" "$V1_OUT"

make_cert() {
  local name="$1"
  local common_name="$2"
  openssl req -x509 -newkey rsa:2048 -nodes     -keyout "$TMP/$name.key.pem"     -out "$TMP/$name.cert.pem"     -days 2     -subj "/CN=$common_name" >/dev/null 2>&1
  openssl x509 -in "$TMP/$name.cert.pem" -outform DER -out "$CERT_OUT/$name.der"
}

make_cert v2 devverify-v2
make_cert v3 devverify-v3
make_cert rotated devverify-rotated

printf 'devverify v1 fixture
' > "$TMP/message.txt"

openssl req -x509 -newkey rsa:2048 -nodes   -keyout "$TMP/v1-single.key.pem"   -out "$TMP/v1-single.cert.pem"   -days 2   -subj '/CN=devverify-v1-single' >/dev/null 2>&1
openssl x509 -in "$TMP/v1-single.cert.pem" -outform DER -out "$V1_OUT/single-cert.der"
openssl smime -sign -binary -noattr   -in "$TMP/message.txt"   -signer "$TMP/v1-single.cert.pem"   -inkey "$TMP/v1-single.key.pem"   -outform DER   -out "$V1_OUT/CERT.RSA" >/dev/null 2>&1

openssl req -x509 -newkey rsa:2048 -nodes   -keyout "$TMP/v1-intermediate.key.pem"   -out "$TMP/v1-intermediate.cert.pem"   -days 2   -subj '/CN=devverify-v1-intermediate' >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes   -keyout "$TMP/v1-leaf.key.pem"   -out "$TMP/v1-leaf.csr.pem"   -subj '/CN=devverify-v1-leaf' >/dev/null 2>&1
openssl x509 -req   -in "$TMP/v1-leaf.csr.pem"   -CA "$TMP/v1-intermediate.cert.pem"   -CAkey "$TMP/v1-intermediate.key.pem"   -CAcreateserial   -days 2   -out "$TMP/v1-leaf.cert.pem" >/dev/null 2>&1
openssl x509 -in "$TMP/v1-leaf.cert.pem" -outform DER -out "$V1_OUT/chain-leaf.der"
openssl x509 -in "$TMP/v1-intermediate.cert.pem" -outform DER -out "$V1_OUT/chain-intermediate.der"
openssl smime -sign -binary -noattr   -in "$TMP/message.txt"   -signer "$TMP/v1-leaf.cert.pem"   -inkey "$TMP/v1-leaf.key.pem"   -certfile "$TMP/v1-intermediate.cert.pem"   -outform DER   -out "$V1_OUT/CERT-chain.RSA" >/dev/null 2>&1

node --input-type=module <<'NODE'
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const certRoot = resolve(process.cwd(), 'fixtures/certs');
const certNames = ['v2', 'v3', 'rotated'];
const certOutput = {};
for (const name of certNames) {
  const bytes = await readFile(resolve(certRoot, name + '.der'));
  certOutput[name] = {
    file: name + '.der',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
await writeFile(resolve(certRoot, '../certs.json'), JSON.stringify(certOutput, null, 2) + '\n');

const v1Root = resolve(process.cwd(), 'fixtures/v1');
const v1Names = ['CERT.RSA', 'CERT-chain.RSA', 'single-cert.der', 'chain-leaf.der', 'chain-intermediate.der'];
const v1Output = {};
for (const name of v1Names) {
  const bytes = await readFile(resolve(v1Root, name));
  v1Output[name] = createHash('sha256').update(bytes).digest('hex');
}
await writeFile(resolve(v1Root, '../v1.json'), JSON.stringify(v1Output, null, 2) + '\n');
NODE

echo "Generated APK test certificates and v1 PKCS#7 fixtures."
