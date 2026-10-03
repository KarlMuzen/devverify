#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/fixtures/certs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$OUT"

make_cert() {
  local name="$1"
  local common_name="$2"
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$TMP/$name.key.pem" \
    -out "$TMP/$name.cert.pem" \
    -days 2 \
    -subj "/CN=$common_name" >/dev/null 2>&1
  openssl x509 -in "$TMP/$name.cert.pem" -outform DER -out "$OUT/$name.der"
}

make_cert v2 devverify-v2
make_cert v3 devverify-v3
make_cert rotated devverify-rotated

node --input-type=module <<'NODE'
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), 'fixtures/certs');
const names = ['v2', 'v3', 'rotated'];
const output = {};
for (const name of names) {
  const bytes = await readFile(resolve(root, name + '.der'));
  output[name] = {
    file: name + '.der',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
await writeFile(
  resolve(root, '../certs.json'),
  JSON.stringify(output, null, 2) + '\n',
);
NODE

echo "Generated APK test certificates in fixtures/certs."
