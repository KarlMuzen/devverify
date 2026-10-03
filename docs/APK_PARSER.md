# APK parser

The APK parser handles untrusted APK bytes with bounded random-access reads. It extracts Android manifest metadata and declared signer certificates; it does not verify APK signatures, signer digests, certificate chains, APK contents, or proof-of-rotation cryptographic validity.

## Pipeline

1. Locate the ZIP End of Central Directory and read the central directory without reading the whole APK.
2. Read only the `AndroidManifest.xml` entry, capped at 8 MiB after inflation.
3. Parse Android binary XML string pools and the supported XML chunks needed for `<manifest>` and `<uses-sdk>`.
4. Extract v2/v3/v3.1 signer certificates from the APK Signing Block and v1/JAR certificate chains from `META-INF/*.RSA`, `*.DSA`, and `*.EC`.
5. Reconcile signer certificates across schemes, retaining disagreements and identifying the preferred v2/v3.x signer.
6. Return metadata, signer state, warnings, and the parser read statistics.

## Android binary XML support

The AXML reader supports:

- XML headers and string pools with UTF-8 and UTF-16 strings, including one- and two-unit length encodings.
- Optional resource-map chunks.
- Namespace start/end chunks.
- Start/end element chunks.
- Unknown chunk types, which are skipped using their bounded chunk sizes.

From the root `<manifest>`, the parser reads the namespace-free `package` attribute plus `android:versionCode` and `android:versionName`. From a direct child `<uses-sdk>`, it reads `android:minSdkVersion` and `android:targetSdkVersion`.

The inflated manifest is capped at 8 MiB. Every AXML chunk, string-pool offset, attribute range, and typed value is bounds-checked. Malformed binary XML is reported through `MANIFEST_INVALID` by `parseApk()`.

## Signatures

v2, v3, and v3.1 certificates are read from the APK Signing Block. v1/JAR signature files are parsed as bounded PKCS#7 SignedData. Signer identity is reported from the declared certificate material.

When multiple schemes expose different certificates, the parser keeps every distinct fingerprint, sets `signersDisagree`, and emits a warning. v3/v3.1 proof-of-rotation attributes are surfaced as `hasRotationLineage`.

A missing signature is not an error: `parseApk()` returns an empty signer list and a warning.

## Random-access and Node entry

All APK reads use `RandomAccessSource`; tests include counting and sparse virtual sources to detect accidental whole-file reads. The `@devverify/core/node` entry exposes `fileSource()`, backed by `fs.promises.open()`, for local APK files. The browser entry will provide the corresponding Blob-backed source in Phase 5.

## Error contract

`parseApk()` uses these stable high-level codes for archive/manifest failures:

- `NOT_A_ZIP`: ZIP structure could not be located or validated.
- `NO_MANIFEST`: the central directory has no `AndroidManifest.xml` entry.
- `MANIFEST_INVALID`: the manifest entry cannot be read or parsed as supported AXML.

Lower-level typed `ApkParseError` codes remain available for parser diagnostics.

## Limits and threat model

The parser treats lengths, offsets, chunk sizes, signer counts, certificate sizes, and entry sizes as hostile input. ZIP central-directory and signing-block limits remain those documented by their modules; v1 signatures are capped at 1 MiB; DER depth is capped at 16; the inflated manifest is capped at 8 MiB.

The parser is a metadata extractor, not a cryptographic verifier. A successful fingerprint result means that the certificate was declared by the APK's supported signature structures, not that the APK's signature or digest was independently verified.

## Live cross-check

For human validation, compare three representative APKs (v1-only, v2/v3, and one with rotated key lineage) against:

`apksigner verify --print-certs <apk>`

Record the observed certificate fingerprints and scheme/lineage differences in `docs/LIVE_VERIFICATION.md`. This remains a human verification item until performed.
