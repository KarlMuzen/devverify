# APK parser

The APK parser is designed for untrusted APK bytes and reads only the ranges needed for ZIP metadata and APK Signature Scheme v2/v3/v3.1 certificate extraction.

## Scope

- Reads ZIP EOCD data with one tail read and supports ZIP64 EOCD records plus ZIP64 central-directory extra fields.
- Reads the central directory in one bounded range and supports stored and deflated entries through Web CompressionStream.
- Locates the APK Signing Block immediately before the central directory and validates both 64-bit size fields and the magic.
- Extracts declared signer certificates from v2, v3, and v3.1 signer records and computes SHA-256 fingerprints of the first certificate.
- Flags the v3/v3.1 proof-of-rotation attribute as rotation lineage.
- Caps signing blocks, signer counts, certificate counts, certificate size, central-directory size, and inflated entry size.

The parser does not verify APK signatures, signer digests, certificate chains, APK contents, or proof-of-rotation cryptographic validity. A certificate is treated as declared signer material for reporting only.

## Random-access model

All APK reads use `RandomAccessSource`. Tests include a counting source and a sparse virtual source so large APKs can be parsed without reading the full file into memory.

## Fixtures

Throwaway X.509 DER certificates live under `fixtures/certs/` and their SHA-256 values are recorded in `fixtures/certs.json`. Regenerate them with `scripts/gen-fixtures.sh` when replacing the test fixtures.
