# APK parser fixtures

The committed files under this directory are synthetic, short-lived X.509 DER test certificates. The v1 parser tests construct deterministic PKCS#7 structures from these certificates.

Use `scripts/gen-fixtures.sh` to generate additional OpenSSL-backed certificate and `.RSA` fixtures for manual validation. The temporary private keys are never committed.
