# devverify — Codex build plan

Phase- and subphase-wise prompts. Each subphase = one Codex task = one branch/PR. Paste the prompt block as-is.

Companion file: `AGENTS.md` (commit it to the repo root before task 0.1).

---

## 0. How to use

1. Create a public GitHub repo (`devverify`). Commit `AGENTS.md` to the root.
2. Create a Codex environment for the repo (cloud) or open Codex CLI at the repo root.
3. Sanity check first. Prompt: `List the non-negotiable rules you loaded from AGENTS.md.` If the list is incomplete, fix the file size or location before continuing.
4. Run tasks in order. Merge only when `pnpm verify` passes and you have skimmed the diff.
5. Items marked **HUMAN** cannot be done by Codex (accounts, secrets, live network checks).

### Codex environment

- Setup script: `corepack enable && pnpm install --frozen-lockfile` (use plain `pnpm install` until task 0.1 creates the lockfile).
- Keep agent-phase internet access off. Every task is written to work offline.
- Do not put the real API key in any Codex environment. It exists only as a GitHub Actions secret.
- Codex loads `AGENTS.md` files from the repo root down to the working directory and caps the combined size (32 KiB by default). The root file here is about 5 KiB, so there is room for the two nested files created in task 0.3.

### Optional global `~/.codex/AGENTS.md` (your style, applies to all repos)

```md
# Global preferences
- No pleasantries, no sign-offs. Start with the answer.
- Be concise. Show diffs, not unchanged code, unless asked.
- Short, punchy formatting over prose.
- When several designs are possible, pick the best one and state why in one line.
```

---

## Phase 0 — Foundation

### 0.1 Monorepo scaffold

````text
TASK 0.1 — Monorepo scaffold

GOAL
Create an empty-but-green pnpm TypeScript monorepo.

DO
- Root: package.json (private, "type":"module", engines.node ">=22", "packageManager" pnpm via corepack), pnpm-workspace.yaml (packages/*, apps/*), .nvmrc (latest Node LTS available in this environment), .gitignore (node_modules, dist, .astro, coverage, /data), .editorconfig, LICENSE (MIT), README.md stub that includes the non-affiliation disclaimer.
- tsconfig.base.json: strict, noUncheckedIndexedAccess, noImplicitOverride, verbatimModuleSyntax, target ES2022, module ESNext, moduleResolution Bundler, skipLibCheck false.
- ESLint flat config with typescript-eslint (type-checked recommended). Prettier: single quotes, 100 columns.
- Vitest with a root workspace config and v8 coverage.
- Packages, each with package.json, tsconfig.json, src/index.ts and one smoke test:
  - packages/core  (@devverify/core)
  - packages/cli   (devverify)
  - apps/crawler   (@devverify/crawler, private)
  - apps/action    (private)
  - apps/site      (empty dir with .gitkeep; Astro arrives in task 3.1)
- Libraries (core, cli, crawler) build with tsup to ESM + .d.ts.
- Root scripts: lint, typecheck, test, build, format, verify (= lint && typecheck && test && build).
- packages/core/src/brand.ts exporting PROJECT_NAME = 'devverify' and DISCLAIMER = 'Independent project. Not affiliated with or endorsed by Google or F-Droid.'

DON'T
- Add Astro or any dependency beyond: typescript, tsup, tsx, vitest, @vitest/coverage-v8, eslint, typescript-eslint, prettier, and zod (core only).

ACCEPT
- From a clean checkout, `pnpm install && pnpm verify` passes.
- No network needed after install.

VERIFY
pnpm install && pnpm verify
````

### 0.2 CI and repository hygiene

````text
TASK 0.2 — CI and repo hygiene

GOAL
Add CI and community files. No third-party actions.

DO
- .github/workflows/ci.yml: on push to main and on pull_request. permissions: contents: read. concurrency group per ref with cancel-in-progress. Steps: actions/checkout, `corepack enable`, actions/setup-node (node-version-file .nvmrc, cache pnpm), `pnpm install --frozen-lockfile`, `pnpm verify`.
- .github/dependabot.yml: weekly updates for npm and github-actions.
- Issue forms (.github/ISSUE_TEMPLATE/): bug.yml, incorrect-status.yml (fields: package name, status shown, expected status, evidence link, contact optional), config.yml (blank issues disabled).
- .github/pull_request_template.md with checklist: pnpm verify passes, tests added, docs updated, no secrets, wording rules respected.
- SECURITY.md (private reporting via GitHub advisories), CODE_OF_CONDUCT.md (short, links to Contributor Covenant), CONTRIBUTING.md (setup, `pnpm verify`, how tasks/PRs work).

DON'T
- Use any action other than official actions/*.

ACCEPT
- Workflow YAML is valid (run actionlint if available; otherwise review by eye and say so in the report).
- List every action used, with its major tag, in docs/LIVE_VERIFICATION.md (create the file if missing, with a header and the table columns: Item | Question | How to verify | Result | Status).

VERIFY
pnpm verify
````

### 0.3 Docs skeleton and nested AGENTS.md files

````text
TASK 0.3 — Docs skeleton, progress tracker, nested AGENTS.md

GOAL
Give future tasks durable context in the repo.

DO
1. docs/ARCHITECTURE.md: static-first pipeline (F-Droid indexes -> scheduled crawler <-> Google Status API -> data branch -> Astro static build -> GitHub Pages + badge endpoints). Explain why there is no backend (data changes daily; 1,000 requests/day quota rules out live lookups). Explain the shared TypeScript core used by crawler, CLI/Action and browser tool. List the repo layout from AGENTS.md.
2. docs/decisions/ ADRs (short, 10-20 lines each): 0001 record decisions; 0002 TypeScript monorepo; 0003 git as database (sorted NDJSON, `data` branch); 0004 no backend; 0005 Astro for the site.
3. docs/PROGRESS.md: checklist of every task id and title from this plan: 0.1-0.3, 1.1-1.5 (1.4a/b/c), 2.1-2.5, 3.1-3.7, 4.1-4.3, 5.1-5.3, 6.1-6.4, 7.1-7.3. All unchecked except 0.1-0.3.
4. docs/LIVE_VERIFICATION.md: ensure the table exists and add these rows, Status = "open":
   - Status API: package-name path encoding (dots vs hyphens in the URL)
   - Status API: response for invalid/unknown package names (400 vs NOT_REGISTERED)
   - Status API: 429 behavior, Retry-After, any per-minute limits, daily quota reset time
   - Status API: terms of service allow publishing a public dataset of results
   - Google Cloud: does API-key creation / enabling this API require a billing account
   - F-Droid signer-index.json: real JSON shape, multi-signer representation, which fingerprint is "current"
   - F-Droid signer-index.json: ETag / Last-Modified support for conditional GET
   - GitHub Actions: current JavaScript runtime id for action.yml (node24 expected)
   - GitHub Actions: does a workflow's own data-branch commit count as repository activity for the 60-day scheduled-workflow rule
   - APK parser: cross-check 3 real APKs (v1-only, v2/v3, rotated key) against `apksigner verify --print-certs`
   - Official docs links in guidance module still resolve
   - npm package names `devverify` / `@devverify/core` available
5. Nested instructions (create exactly these files):

packages/core/AGENTS.md
---
# packages/core rules
- `src/apk/**` and `src/status/**` must be isomorphic: no `node:*` imports, no `Buffer`, no `fs`. Use Uint8Array, DataView with explicit little-endian reads, and web `crypto.subtle`.
- Treat every byte as hostile. Bounds-check every read, cap sizes (inflated manifest <= 8 MiB, signing block <= 64 MiB, central directory <= 64 MiB, <= 32 signers/certs), reject overflowing or overlapping offsets, cap DER depth at 16. Throw typed `ApkParseError` with a stable `code`.
- The parser extracts declared signer certificates. It does NOT verify signatures or digests. Say so in JSDoc and docs/APK_PARSER.md.
- Fingerprint = SHA-256 of the DER certificate as 64 lowercase hex chars. Other forms only via `formatFingerprint()`.
- All APK reads go through `RandomAccessSource`; never read a whole APK. Tests assert the maximum bytes read.
- Fixtures are generated by `scripts/gen-fixtures.sh` (openssl) and committed. Keys are throwaway test keys and labelled as such in fixtures/README.md.
---

apps/site/AGENTS.md
---
# apps/site rules
- Static output only. No server endpoints, no runtime requests to third parties, no analytics, no web fonts, no cookies.
- Dataset is validated at build time with zod. Invalid data fails the build.
- Zero JS by default. Preact islands only for search/table and the APK tool, hydrated lazily.
- Accessibility: semantic HTML, WCAG 2.2 AA contrast, visible focus, status shown as text + icon + color, keyboard operable, prefers-reduced-motion respected. Every chart has a table fallback.
- /tools/apk-fingerprint/ has a CSP meta tag with `connect-src 'self'`. The APK never leaves the device.
- Page weight: app detail HTML <= 60 KB gzip; zero JS on content pages.
- Wording rules from the root AGENTS.md apply to every string.
---

ACCEPT
- Files exist with exactly the content above (without the --- lines).
- `pnpm verify` still passes.
````

---

## Phase 1 — `packages/core`

### 1.1 Domain primitives

````text
TASK 1.1 — Domain primitives in @devverify/core

GOAL
Validated primitives used everywhere else.

DO (packages/core/src/)
- package-name.ts: isValidPackageName(s) — at least 2 dot-separated segments, each /^[A-Za-z][A-Za-z0-9_]*$/, total length <= 255; assertPackageName throws a typed error.
- fingerprint.ts:
  - normalizeFingerprint(input): accepts 64 hex chars in any case with optional ':' separators; returns 64 lowercase hex or throws FingerprintError.
  - formatFingerprint(fp, 'hex' | 'colon-upper').
  - sha256Hex(bytes: Uint8Array) using globalThis.crypto.subtle.
  - equalFingerprints(a, b).
- status/types.ts: ApiState = 'REGISTERED' | 'NOT_REGISTERED' | 'REGISTERED_WITH_ANOTHER_CERTIFICATE_FINGERPRINT' | 'UNKNOWN'; AppStatus = 'registered' | 'registered_other_key' | 'not_registered' | 'unknown'; mapApiState(raw: string): ApiState (unrecognized -> 'UNKNOWN').
- status/derive.ts: deriveAppStatus(results: {fingerprint: string; state: ApiState}[]): AppStatus. Precedence: any REGISTERED -> registered; else any REGISTERED_WITH_ANOTHER_CERTIFICATE_FINGERPRINT -> registered_other_key; else any NOT_REGISTERED -> not_registered; else unknown. Empty -> unknown.
- errors.ts: DevVerifyError base class with `code`.
- index.ts re-exports.

TESTS
Table-driven: uppercase and colon-separated fingerprints, 63/65-char input, non-hex, package names (leading digit, single segment, hyphen, trailing dot), full derive precedence matrix, mapApiState with unknown strings.

ACCEPT
- >= 95% line coverage on the new files.

VERIFY
pnpm --filter @devverify/core test -- --coverage && pnpm verify
````

### 1.2 Status API client

````text
TASK 1.2 — Android Developer ID Status API client

CONTEXT
Public API, API-key auth. Base URL https://androiddeveloperidstatus.googleapis.com
GET /v1/packages/{package}/packageRegistrationStatus:check[?certificateFingerprint=<64 lowercase hex>]
Header: X-Goog-Api-Key. HTTP 200 body: {"name": "...", "state": "REGISTERED" | "NOT_REGISTERED" | "REGISTERED_WITH_ANOTHER_CERTIFICATE_FINGERPRINT"}.
Errors use Google's JSON error object {error:{code,message,status}}: 400 INVALID_ARGUMENT, 401 UNAUTHENTICATED, 403 PERMISSION_DENIED, 429 RESOURCE_EXHAUSTED, 500 INTERNAL, 503 UNAVAILABLE.
KNOWN DOC CONFLICT: the guide's curl uses dots in {package}; the generated client reference says dots must be replaced by hyphens. Support both; default to dots; record in docs/LIVE_VERIFICATION.md.

DO (packages/core/src/status/)
- client.ts: createStatusClient({ apiKey, fetch = globalThis.fetch, baseUrl, packageNameEncoding: 'dots' | 'hyphens' = 'dots', timeoutMs = 15000, maxAttempts = 4, sleep, random, budget?: RequestBudget, onRequest? }) returning { check(pkg, fingerprint?) -> { package, fingerprint?, state: ApiState, rawState: string } }.
  - Validate inputs with assertPackageName / normalizeFingerprint first. Send the key only in the X-Goog-Api-Key header, never in the URL.
  - Parse the body with zod (passthrough). Unknown states map to 'UNKNOWN' and keep rawState.
- errors.ts: AuthError (401/403), BadRequestError (400), QuotaExhaustedError (429), TransientError (5xx/network/timeout after retries), ProtocolError (bad JSON/shape). Messages must never contain the API key.
- retry.ts: exponential backoff 500ms * 2^n, cap 8s, full jitter. Retry only 5xx, network errors, timeouts. 429: if Retry-After <= 30s wait and retry at most 2 times, otherwise throw QuotaExhaustedError immediately.
- budget.ts: RequestBudget(limit) with take() that throws BudgetExhaustedError. EVERY HTTP attempt (including retries) calls take() first.
- limiter.ts: createLimiter(concurrency) semaphore (no dependency).
- fake.ts: createFakeStatusClient({seed}) — deterministic states by hashing package name (roughly 25% registered, 10% other key, 65% not registered). Used by offline end-to-end runs.
- redact.ts: redactSecrets(text, secrets[]).

TESTS (injected fetch, fake timers; no network)
- Both encodings produce the expected URL. Fingerprint query param is lowercase hex.
- Each documented error status maps to the right error class. Retry counts and delays are as specified. Retries consume budget. 429 with Retry-After 5 retries; with 120 or missing aborts.
- JSON.stringify of any thrown error never contains the API key.
- Limiter never exceeds concurrency.

ACCEPT
- >= 90% line coverage on status/.

VERIFY
pnpm --filter @devverify/core test -- --coverage && pnpm verify
````

### 1.3 Package sources and the F-Droid adapter

````text
TASK 1.3 — PackageSource interface and F-Droid signer-index adapter

CONTEXT
F-Droid publishes https://f-droid.org/repo/signer-index.json, a simple index of the SHA-256 fingerprint of each signer f-droid.org uses per package. The exact JSON shape has NOT been verified by the author. Do not guess: be tolerant and make the live check easy.

DO
- src/source.ts: interface PackageSource { id: string; load(opts: { fetch?: typeof fetch; validators?: { etag?: string; lastModified?: string } }): Promise<SourceSnapshot> }; SourceSnapshot = { entries: { package: string; fingerprints: string[] }[]; validators?: { etag?: string; lastModified?: string }; notModified?: boolean; fetchedAt: string; warnings: string[] }.
- src/fdroid/signer-index.ts: parseSignerIndex(json: unknown) tolerant of these shapes:
  (a) object map package -> string[] of fingerprints
  (b) object map package -> object containing a string or string[] under keys like signer, signers, sha256, fingerprints
  (c) array of objects with package|packageName|id plus the same fingerprint keys
  Normalize with normalizeFingerprint; drop invalid values into warnings; drop invalid package names into warnings; dedupe; sort by package then fingerprint. Throw SourceFormatError only if nothing recognizable is found. Do NOT assign meaning to fingerprint order.
- src/fdroid/index.ts: createFdroidSource({ url }) using conditional GET (If-None-Match / If-Modified-Since), handling 304, a 50 MB body cap and a 60 s timeout.
- fixtures/fdroid/: signer-index.shapeA.json, shapeB.json, shapeC.json (small, synthetic), malformed.json.
- scripts/describe-signer-index.ts: only when LIVE=1 fetch the live file and print top-level type, entry count, three truncated sample entries, and which parser shape matched. No writes.

TESTS
Each shape parses to identical normalized output; warnings for bad fingerprints; 304 path; oversize body rejected; malformed -> SourceFormatError.

ACCEPT
- docs/LIVE_VERIFICATION.md rows for signer-index shape and conditional-GET support reference scripts/describe-signer-index.ts as the verification method.

VERIFY
pnpm --filter @devverify/core test && pnpm verify
````

### 1.4a ZIP reader and v2/v3 signing-block certificates

````text
TASK 1.4a — Random-access ZIP reader and APK Signature Scheme v2/v3 certificate extraction

GOAL
Extract signer certificates from an APK WITHOUT reading the whole file.

DO (packages/core/src/apk/)
- source.ts: interface RandomAccessSource { size: number; read(offset: number, length: number): Promise<Uint8Array> }. Helpers: createBufferSource(u8), createCountingSource(inner) exposing bytesRead and readCalls, createVirtualSource(size, patches) returning zeros except at patched offsets (for tests with huge sparse files).
- zip.ts:
  - findEocd: scan the last min(size, 65557) bytes in ONE read.
  - ZIP64: support EOCD64 locator/record and extra field 0x0001 for sizes/offsets.
  - readCentralDirectory: ONE read of [cdOffset, cdSize]; cap 64 MiB; return entries {name, method, compressedSize, uncompressedSize, localHeaderOffset}.
  - readEntry(name): read the local header (name+extra lengths) then the data; support stored and deflate (DecompressionStream('deflate-raw'); if unavailable, throw a typed error — do not add a dependency). Enforce a max inflated size.
- signing-block.ts: locate the APK Signing Block ending right before the central directory (16-byte magic "APK Sig Block 42" at cdOffset-16; the two size fields must match). Parse ID-value pairs (uint64 length, uint32 id, value). Extract signers for v2 (id 0x7109871a), v3 (0xf05368c0), v3.1 (0x1b93ad61):
  - v2 value: uint32-length-prefixed sequence of signers; signer = length-prefixed signed data, signatures, public key; signed data = length-prefixed digests, certificates (sequence of length-prefixed X.509 DER), additional attributes.
  - v3/v3.1 signed data additionally contains minSdk/maxSdk (uint32 each) before additional attributes; detect proof-of-rotation attribute id 0x3ba06f8c and expose hasRotationLineage.
  - Return per signer: { scheme: 'v2' | 'v3' | 'v3.1', certificates: Uint8Array[] (DER), minSdk?, maxSdk?, hasRotationLineage }. The first certificate is the signer certificate. Add fingerprint = sha256Hex(DER).
- All lengths are untrusted: bounds-check, cap, reject overflow.

TESTS
- scripts/gen-fixtures.sh (openssl) creates throwaway test certificates (.der) and a fixtures/certs.json with each expected SHA-256. Commit outputs. (If openssl is unavailable, embed pre-generated DER bytes as base64 constants and say so in the report.)
- tests/helpers/build-apk.ts assembles synthetic APKs: local headers + data, central directory, EOCD, optional signing block (v2/v3/v3.1, N signers). Signatures may be dummy bytes: the parser does not verify them.
- Cases: no signing block -> []; bad magic; size-field mismatch; truncated; multiple signers; rotation attribute flagged; ZIP64; EOCD comment; stored vs deflated entry; absurd declared lengths rejected.
- Efficiency test: a virtual 600 MiB APK (structure patched at the end) parses with < 4 MiB read through the counting source.

ACCEPT
- >= 90% line coverage on apk/zip.ts and apk/signing-block.ts.

VERIFY
pnpm --filter @devverify/core test -- --coverage && pnpm verify
````

### 1.4b v1 (JAR) fallback and minimal DER

````text
TASK 1.4b — v1 (JAR) signature fallback via a minimal DER/PKCS#7 reader

DO (packages/core/src/apk/)
- der.ts: minimal DER reader (tag, length, value) — definite lengths only, depth cap 16, strict bounds checks; helpers for SEQUENCE/SET/INTEGER/OID/context-specific tags.
- v1.ts: from the central directory find META-INF/*.RSA, *.DSA, *.EC (case-insensitive); read each (cap 1 MiB); parse PKCS#7 SignedData: take certificates [0]; identify the signer certificate by matching SignerInfo issuerAndSerialNumber against each certificate's TBS issuer + serialNumber; if no match, fall back to the first certificate. Return { scheme: 'v1', certificates: DER[] } per signature file.
- signers.ts: combineSigners(v2v3, v1) -> { signers: { fingerprint, schemes: string[], isCurrent }[], signersDisagree: boolean, warnings: string[] }. Prefer v3.x/v2 over v1 when present. If distinct fingerprints appear across schemes set signersDisagree = true and keep all distinct fingerprints (key rotation commonly causes this).
- Extend scripts/gen-fixtures.sh to create CERT.RSA fixtures with openssl (e.g. `openssl smime -sign -binary -noattr -outform DER`), including a leaf + intermediate chain case.

TESTS
Single cert; chain (leaf chosen via issuer/serial); garbage input; truncated input; indefinite-length encoding rejected; depth bomb rejected; combineSigners disagreement cases.

ACCEPT
- >= 90% line coverage on der.ts, v1.ts, signers.ts.

VERIFY
pnpm --filter @devverify/core test -- --coverage && pnpm verify
````

### 1.4c Binary manifest and `parseApk()`

````text
TASK 1.4c — Android binary XML (AXML) manifest parsing and parseApk()

DO (packages/core/src/apk/)
- axml.ts: parse Android binary XML. Chunks: XML header (0x0003), string pool (0x0001; UTF-8 and UTF-16 flags; handle 1- and 2-unit length encodings), optional resource map (0x0180), START_NAMESPACE/END_NAMESPACE, START_ELEMENT (0x0102), END_ELEMENT. Return from the root <manifest>: package (attribute without namespace), versionCode (android:versionCode, int), versionName (string); from <uses-sdk>: minSdkVersion, targetSdkVersion. Tolerate unknown chunk types by skipping via chunk size. Typed errors.
- parse.ts: parseApk(source: RandomAccessSource) -> { packageName, versionCode?, versionName?, minSdk?, targetSdk?, signers: { fingerprint, schemes: string[], isCurrent }[], signersDisagree, hasRotationLineage, warnings: string[], stats: { bytesRead, reads } }.
  - Error codes: NOT_A_ZIP, NO_MANIFEST, MANIFEST_INVALID. A missing signature is NOT an error: return signers [] plus a warning.
- src/node.ts (separate entry exported as `@devverify/core/node`): fileSource(path) using fs.promises.open.
- tests/helpers/axml-encode.ts: tiny AXML encoder for tests.
- docs/APK_PARSER.md: what is and is not verified (no signature/digest verification; extracts declared certificates), supported schemes, limits, threat model, how to cross-check with `apksigner verify --print-certs`.

TESTS
Encoder round-trips (UTF-8 and UTF-16 pools); missing attributes; end-to-end synthetic APK via parseApk; error codes; stats show small reads.

ACCEPT
- >= 90% coverage on axml.ts and parse.ts.

VERIFY
pnpm --filter @devverify/core test -- --coverage && pnpm verify
````

### 1.5 Remediation guidance (shared text)

````text
TASK 1.5 — Remediation guidance module (i18n-ready)

GOAL
One source of user-facing guidance for site, CLI and Action.

DO (packages/core/src/guidance/)
- en.ts: dictionary of strings (keys like guidance.registered.title). t(key, params) helper. No hardcoded strings elsewhere.
- index.ts: getGuidance(status, ctx: { package: string; fingerprint?: string; origin: 'fdroid' | 'apk' }) -> { title, summary, steps: string[], links: { label, url }[] }.
- States: registered; registered_other_key; not_registered; unknown. Variants:
  - origin 'fdroid': F-Droid re-signs many apps with its own key, so the developer's registration may not cover the F-Droid build. Maintainers either register F-Droid's signing key for their package name (per Google's open-source registration guide) or work toward reproducible builds so the published APK carries their own signature.
  - origin 'apk' (CI use): the key used to sign this build is or is not covered.
  - registered_other_key: the package name is registered, but to a different signing key than the one checked; the maintainer should check which keys are registered for their package name. Also note it may be a different developer.
- Links only to official developer.android.com/developer-verification pages: overview, guides/open-source-app-registration, guides/check-registration-status, guides/limited-distribution, guides/full-distribution, guides/faq. Paraphrase; do not copy text.
- Tests: snapshot each state/origin; a banned-phrases test fails if any string contains "will be blocked", "ADC", or "claim a package name"; every link is https and on developer.android.com.
- Add a docs/LIVE_VERIFICATION.md note to re-check link validity.

VERIFY
pnpm --filter @devverify/core test && pnpm verify
````

**Gate 1 (HUMAN):** run the parser on 3 real APKs (v1-only, v2/v3, rotated key) and compare with `apksigner verify --print-certs`. Record in `docs/LIVE_VERIFICATION.md`.

---

## Phase 2 — Data model and crawler

### 2.1 Dataset schemas, deterministic storage, sample data

````text
TASK 2.1 — Dataset schemas, deterministic storage, sample data

GOAL
Define the on-disk dataset and a DataStore with byte-stable output.

DO (packages/core/src/data/)
- schemas.ts (zod):
  AppRecord { package, source: 'fdroid', fingerprints: string[], checkedFingerprints: string[], status: AppStatus, firstSeenAt: ISO, checkedAt?: ISO, statusChangedAt?: ISO, firstRegisteredAt?: ISO, errorCount: number (default 0), lastError?: { at: ISO, code: string, message: string }, removedAt?: ISO }
  EventRecord { at: ISO, package, from: AppStatus | null, to: AppStatus }
  TimeseriesRow { date: YYYY-MM-DD, total, registered, registered_other_key, not_registered, unknown }
  Meta { schemaVersion: 1, sources: { [id]: { etag?, lastModified?, fetchedAt?, packageCount? } }, lastRun?: { startedAt, finishedAt, requestsUsed, budget, exitReason, counts } }
- serialize.ts: toNdjson (sorted by package, fixed key order, no trailing spaces), parseNdjson with line-numbered errors, CSV for timeseries (header row), pretty sorted JSON for meta.
- store.ts: createDataStore(dir, fsAdapter?) with load() and save(); atomic writes (temp file + rename); creates missing files; rejects newer schemaVersion; migration hook for older ones.
- Files on disk: apps.ndjson, events.ndjson (append-only; stored sorted by at then package), timeseries.csv, meta.json.
- scripts/make-sample-data.ts: deterministic (seeded PRNG) -> fixtures/sample-data/ with 80 fake packages (com.example.*), mixed states, 120 days of timeseries, ~60 events, a few removed records, a few records with lastError.

TESTS
Round-trip is byte-identical; key-order stability; atomic write leaves the old file intact on simulated failure; bad lines report line numbers; newer schemaVersion rejected.

ACCEPT
- save(load(sample)) produces zero diff.

VERIFY
pnpm --filter @devverify/core test && pnpm verify
````

### 2.2 Sync, check-result application, scheduler (pure functions)

````text
TASK 2.2 — Sync, apply-result, and scheduler

DO (packages/core/src/crawl/)
- sync.ts: syncRecords({ records, entries, now, source }) -> { records, added, removed, fingerprintChanged }.
  - New entry: status 'unknown', firstSeenAt = now, never checked.
  - Fingerprint set changed: keep status, clear checkedAt and checkedFingerprints (forces a recheck).
  - Missing from source: set removedAt = now (keep record). Reappears: clear removedAt. Purge records removed for more than 30 days.
- apply.ts:
  - applyCheckResult(record, results, now) -> { record, event? } using deriveAppStatus. Sets checkedAt and checkedFingerprints; on status change sets statusChangedAt and an EventRecord; sets firstRegisteredAt the first time status becomes 'registered'; clears lastError and errorCount.
  - applyCheckError(record, error, now): errorCount++, lastError with sanitized, truncated (200 chars) message; status unchanged.
  - computeTimeseriesRow(records, dateUtc) counting non-removed records.
  - Fingerprint check policy: checkFingerprints(record, maxPerPackage = 2) returns the fingerprints to check; the crawler stops checking a package's fingerprints as soon as one returns REGISTERED.
- schedule.ts: selectBatch({ records, now, budget, config }) -> package names.
  - Exclude removed records.
  - Never-checked first (ordered by firstSeenAt, then package).
  - Then by priority = ageHours / recheckAfterHours[status]. Defaults: not_registered 24, registered_other_key 24, unknown 12, registered 168.
  - Records with errorCount > 0 are eligible only after min(24h, 2^errorCount hours) since the last attempt.
  - Take the top `budget` by priority; ties broken by package name. Pure and deterministic.
  - NOTE: budget counts API calls; a package may need up to 2 calls. selectBatch takes a `maxPackages` derived by the caller as floor(budget / 1.3) by default; document the reasoning in docs/SCHEDULING.md.

TESTS
- Each function, including edge cases (reappearing records, fingerprint change, error backoff).
- Simulation: 3,800 records, 70% not registered, budget 950 calls/day, 60 simulated days. Assert and document the achieved bounds in docs/SCHEDULING.md: not-registered records are rechecked within 5 days and no record waits more than 30 days. If these bounds are unachievable, tune the priority weights and document the actual bounds.
- Determinism: same input -> same output.

VERIFY
pnpm --filter @devverify/core test && pnpm verify
````

### 2.3 Crawler runner

````text
TASK 2.3 — Crawler CLI (apps/crawler)

GOAL
`pnpm crawl` runs one budget-bounded crawl pass over the dataset.

DO
- Entry apps/crawler/src/index.ts using util.parseArgs. Flags: --data-dir (default env DEVVERIFY_DATA_DIR or ./data), --budget (default 950), --concurrency (default 4), --dry-run (no writes), --fake (use createFakeStatusClient), --fixture-index <path> (read the source snapshot from a local file instead of the network), --max-fingerprints (default 2).
- Env: ANDROID_DEVID_STATUS_API_KEY (required unless --fake).
- Flow: load store -> load source (conditional GET using stored validators; on 304 reuse records) -> syncRecords -> selectBatch -> check with a limiter and a shared RequestBudget -> applyCheckResult / applyCheckError -> append events -> upsert today's timeseries row -> update meta (validators, lastRun) -> save.
- Stop conditions and exit codes:
  - 0: completed, or budget exhausted, or QuotaExhaustedError (partial progress saved; emit a `::warning::` annotation if it happened before 50% of the budget).
  - 20: AuthError (401/403) — nothing partial is written.
  - 30: source fetch failed or SourceFormatError — previous data untouched.
  - 40: dataset schema error.
- Never exceed --budget API attempts. Never log the API key.
- Write a Markdown summary to $GITHUB_STEP_SUMMARY when set (requests used, status counts, changes, errors). Print one-line JSON result for machines.
- Root script `crawl` -> run the crawler (built JS, not tsx, so CI needs no extra tooling).

TESTS
- End-to-end offline: --fake --fixture-index fixtures/fdroid/signer-index.shapeA.json on a temp copy of fixtures/sample-data. Assert determinism (run twice with the same seed/time -> identical files), budget respected, exit codes for each failure mode (inject faults), dry-run writes nothing.

VERIFY
pnpm verify && pnpm crawl -- --fake --dry-run --fixture-index fixtures/fdroid/signer-index.shapeA.json --data-dir fixtures/sample-data
````

### 2.4 GitHub Actions: crawl workflow and data branch

````text
TASK 2.4 — Scheduled crawl workflow and data-branch tooling

DO
- .github/workflows/crawl.yml:
  - Triggers: schedule cron "17 8 * * *" (offset from the top of the hour; comment explaining why), and workflow_dispatch with inputs budget (default "950") and dry_run (boolean).
  - permissions: contents: write, issues: write. concurrency group "crawl", cancel-in-progress: false.
  - Steps: checkout main; checkout ref `data` into path `data` (fetch-depth 1); corepack enable; setup-node with pnpm cache; pnpm install --frozen-lockfile; build the crawler; run it with env ANDROID_DEVID_STATUS_API_KEY from secrets; if `git -C data status --porcelain` is non-empty commit as github-actions[bot] with message `data: crawl <UTC date> (<N> checks)` and push, retrying with `git pull --rebase` on non-fast-forward (max 3 tries); set a job output `changed`.
  - On failure: open or update a single issue titled "Crawl failed" with the run URL (use the preinstalled `gh` CLI with GH_TOKEN).
  - Optional heartbeat: if secret HEALTHCHECK_URL is set, curl it on success.
  - A second job `deploy` runs only if `changed == 'true'` and calls ./.github/workflows/deploy.yml as a reusable workflow (workflow_call). Grant the caller job the permissions the reusable workflow needs (pages: write, id-token: write). deploy.yml itself is created in task 3.6; until then, guard the call with a comment and a TODO row in docs/PROGRESS.md.
- scripts/bootstrap-data-branch.sh: creates an orphan `data` branch containing empty apps.ndjson, events.ndjson, timeseries.csv (header only), meta.json (schemaVersion 1), a README explaining the branch, and pushes it. Idempotent; refuses to run if `data` already exists.
- scripts/squash-data-branch.sh: replaces `data` history with a single commit of the current tree (force-push). Requires an explicit `--yes`. Print loud warnings. Used for periodic history squashing.
- docs/DATA_BRANCH.md: how to attach a local worktree (`git worktree add data data`), what the branch contains, why it is separate, squash policy (when history exceeds ~200 MB, or monthly).
- Do NOT use third-party actions. List the used actions and their tags in docs/LIVE_VERIFICATION.md.

ACCEPT
- Workflow YAML valid (actionlint if available). Scripts pass shellcheck if available, `set -euo pipefail`.

VERIFY
pnpm verify
````

**HUMAN gate before 2.5:** create a Google Cloud project, enable *Android Developer ID Status API*, create an API key restricted to that API only, add it as repo secret `ANDROID_DEVID_STATUS_API_KEY`. Run `scripts/bootstrap-data-branch.sh`. Read the API terms.

### 2.5 Live verification kit

````text
TASK 2.5 — Live verification scripts (never run by CI)

GOAL
Let a human resolve every "open" row in docs/LIVE_VERIFICATION.md in one sitting.

DO (scripts/, each requires LIVE=1 and exits 2 otherwise)
- live-status-probe.ts: with ANDROID_DEVID_STATUS_API_KEY, for 3 well-known package names and 1 invalid name, call the API with BOTH encodings (dots, hyphens) with and without a fingerprint. Print status code, state, selected headers (retry-after, any x-ratelimit-*), and elapsed ms. Never print the key. Uses at most 12 requests (enforced by RequestBudget).
- live-quota-probe.ts: guarded by an extra flag --yes-burn-quota; sends requests until it receives a 429 or hits 1,000, printing the number sent and the 429 headers/body. Prints a warning that this exhausts the daily quota.
- describe-signer-index.ts (from task 1.3): ensure it also prints response headers (etag, last-modified).
- docs/LIVE_VERIFICATION.md: add a "How to run" section with exact commands and which row each script resolves, plus a "Results" template the human fills in.
- If the probe shows hyphen encoding is required, make `packageNameEncoding` selectable via env DEVVERIFY_PKG_ENCODING and document it.

ACCEPT
- Scripts typecheck and lint. Without LIVE=1 they exit 2 and print what they would do.

VERIFY
pnpm verify
````

**Gate 2 (HUMAN):** run the probes, fill the results, then run the crawl workflow with `dry_run=true`, then for real. A full first pass takes about 4 days at 950 calls/day.

---

## Phase 3 — Static site (Astro)

### 3.1 Scaffold, layout, design system

````text
TASK 3.1 — Astro scaffold

DO (apps/site)
- Astro, static output, @astrojs/preact, @astrojs/sitemap. astro.config reads SITE_URL and BASE_PATH (defaults http://localhost:4321 and '/').
- src/layouts/Base.astro: title/description/canonical/OG tags, skip link, header nav (Home, Apps, Data, Methodology, For maintainers, APK tool), footer with the disclaimer from brand.ts, "Report incorrect status" link to the issue form, license note, and "Data updated <date>" placeholder.
- src/styles/global.css: CSS custom properties, system font stack, light/dark via prefers-color-scheme, responsive layout, focus-visible rings, prefers-reduced-motion. No webfonts.
- Components: StatusBadge.astro (text + glyph + color for the four states), Card.astro, Stat.astro.
- Pages: index (placeholder), 404.
- scripts/check-no-js.ts: fails if dist/ HTML for non-island pages contains <script> tags.

ACCEPT
- `pnpm --filter @devverify/site build` works offline. Zero JS on the index page. Passes pnpm verify.
````

### 3.2 Dataset loader, static API, badges

````text
TASK 3.2 — Dataset loader, static JSON/CSV API, shields.io endpoint badges

DO (apps/site/src)
- lib/data.ts: loadDataset() reads DEVVERIFY_DATA_DIR (default ../../data if present, else ../../fixtures/sample-data) through core's DataStore; zod-validated; memoized; throws (fails the build) on invalid data.
- Endpoints (src/pages/api/v1/):
  - summary.json {generatedAt, lastRun, totals by status, percentages, coverage {checkedWithin7d, pct}, sources}
  - apps.json {fields: [...], rows: [[package, status, checkedAt, statusChangedAt, source], ...]} (compact)
  - apps.csv, timeseries.csv, events.json (latest 500), schema.json (JSON Schema for AppRecord/EventRecord; generate from zod if supported, else hand-write)
  - badge/[package].json — shields.io endpoint format {"schemaVersion":1,"label":"Android verification","message":...,"color":...,"cacheSeconds":86400}. Messages/colors: registered/brightgreen; "registered, other key"/orange; "not registered"/red; unknown/lightgrey. Skip removed records.
  - search-index.json built with MiniSearch (fields: package; store: status).
- Document each endpoint's schema in docs/API.md.

TESTS (vitest in apps/site)
Golden files for sample data; CSV escaping; badge JSON shape; zero endpoints leak lastError messages or any secret-like strings.

VERIFY
pnpm verify
````

### 3.3 Core pages: home, app detail, apps list (no-JS baseline)

````text
TASK 3.3 — Home, app detail, and apps list pages

DO
- index.astro: headline stats (counts and % per status), freshness line (last run time, coverage %), a banner "Initial crawl in progress: X% checked" when coverage < 95%, a short plain-language explainer, and the disclaimer. Chart slot (filled in 3.5).
- apps/[package]/index.astro via getStaticPaths (all non-purged records): status badge; signing fingerprints (full value in <code>, truncated display, select-all friendly); status history from events; guidance from core getGuidance(status, {origin:'fdroid'}); badge embed snippets (Markdown, HTML, and the shields.io endpoint URL pattern built from SITE_URL); link to https://f-droid.org/packages/<package>/ and to official Google docs; "Report incorrect status" link prefilled with the package name; note when a record was removed from the source.
- apps/index.astro: server-rendered first 100 rows (sorted by package) with links to apps.csv and the full list; enhanced in 3.4.
- Wording: say "not registered for the checked signing key", never "blocked".

TESTS
Build with sample data; assert page count equals record count; app page HTML <= 60 KB gzip; no <script> on these pages; banned-phrase scan over dist/.

VERIFY
pnpm verify
````

### 3.4 Search and filter island

````text
TASK 3.4 — Apps table island (Preact)

DO
- src/components/AppsTable.tsx: lazy-loads /api/v1/search-index.json and /api/v1/apps.json after hydration (client:visible). Features: text search (MiniSearch), status filter chips, sort (package, status, checked), pagination (50/page), result count, URL query sync (?q=&status=&page=), keyboard accessible with aria-live result count, empty state, error state with link to apps.csv.
- Replace the static table on /apps/ with the island; keep the server-rendered rows inside <noscript>.
- Bundle budget: island JS <= 30 KB gzip (assert in a script).

TESTS
Component logic unit-tested (filtering, sorting, pagination, URL sync) with Vitest + a DOM environment of your choice already in the allowed dependency list (use happy-dom or jsdom as devDependency; justify in an ADR if new).

VERIFY
pnpm verify
````

### 3.5 Chart and content pages

````text
TASK 3.5 — Time-series chart and content pages

DO
- src/components/TimeSeriesChart.astro: build-time inline SVG (no JS) of stacked status counts over time from timeseries.csv, with <title>/<desc>, axis labels, colorblind-safe palette plus patterns/labels, and a <details> data-table fallback. Place on the home page.
- /methodology/: data sources (F-Droid signer index; Android Developer ID Status API), exactly what a check means (package + signing key reported by F-Droid), check cadence and coverage, fingerprint policy (max 2 per package), limitations (F-Droid-reported signer may not be what a device sees; enforcement currently applies to installs via participating stores in Brazil, Indonesia, Singapore and Thailand, with wider enforcement planned for 2027; status is a snapshot), definitions of the four states, how to dispute a result, independence disclaimer.
- /data/: downloads (CSV/JSON), schema link, license (default CC BY 4.0 for data, MIT for code — note it is configurable in docs/DECISIONS), citation text, update cadence, a curl example.
- /for-maintainers/: step-by-step in your own words for each state, using getGuidance, with links to Google's guides; section for F-Droid re-signing.
- /corrections/: corrections policy and link to the incorrect-status issue form; response-time expectation stated as best effort.
- Add CITATION.cff at repo root.

TESTS
Chart renders for sample data and for empty data; banned-phrase scan; internal link check script (scripts/check-links.ts) over dist/ passes.

VERIFY
pnpm verify
````

### 3.6 Deploy workflow

````text
TASK 3.6 — GitHub Pages deploy workflow

DO
- .github/workflows/deploy.yml: triggers workflow_call, workflow_dispatch, and push to main (paths: apps/site/**, packages/core/**). permissions: contents: read, pages: write, id-token: write. concurrency group "pages". Steps: checkout main; checkout ref `data` into `data` (shallow); corepack + node + pnpm install; set SITE_URL/BASE_PATH from actions/configure-pages outputs; build site with DEVVERIFY_DATA_DIR=data; actions/upload-pages-artifact; actions/deploy-pages in an `environment: github-pages` job.
- Wire crawl.yml's `deploy` job to this workflow (remove the guard from task 2.4).
- docs/DEPLOY.md: enabling Pages (Source: GitHub Actions), custom domain, base path caveats, Cloudflare Pages fallback instructions (build command, output dir apps/site/dist, env vars).

ACCEPT
- YAML valid; build step fails the workflow if the dataset is invalid.

VERIFY
pnpm verify
````

### 3.7 Localization scaffold (optional)

````text
TASK 3.7 — i18n scaffold (en, pt-BR, id, th)

DO
- Astro i18n routing: defaultLocale 'en', locales ['en','pt-BR','id','th'], localized routes ONLY for home, methodology, for-maintainers and the APK tool. App detail pages and the apps table stay English-only.
- src/i18n/{en,pt-BR,id,th}.ts string dictionaries. Non-English files start as copies of en with `// TODO(translate)` and `translationStatus: 'needs-review'`. A visible "Translation needs review" notice renders for any locale with that status.
- Language switcher, hreflang tags, sitemap i18n.
- DO NOT machine-translate for publication.

VERIFY
pnpm verify
````

---

## Phase 4 — CLI and GitHub Action

### 4.1 CLI

````text
TASK 4.1 — `devverify` CLI (packages/cli)

DO
- Bin `devverify` (ESM, shebang via tsup banner). Use util.parseArgs. Commands:
  - `devverify apk <file> [--json] [--check] [--fail-on none|not-registered|any-unregistered] [--also-check <fingerprint>...]`
  - `devverify fingerprint <file>` — print distinct signer fingerprints, one per line
  - `devverify status <package> [--fingerprint <hex>] [--json]`
  - `devverify lookup <package> [--site <url>]` — read the public snapshot (badge JSON) and print the state and page link
  - `--help` (includes the disclaimer), `--version`
- API key ONLY from env ANDROID_DEVID_STATUS_API_KEY. No --api-key flag (shell-history leaks).
- `--check`: query every distinct signer fingerprint (cap 4 plus --also-check) with a RequestBudget. Default policy: fail when no fingerprint is REGISTERED; warn when only some are or signers disagree; print guidance from core.
- Exit codes: 0 ok; 1 policy failure (per --fail-on); 2 usage error; 3 config/auth/quota error; 4 APK parse error.
- Human output: compact table; colors only on TTY and never when NO_COLOR is set. `--json` output has a stable, documented schema (docs/CLI.md).

TESTS
Injected fs/fetch/client; snapshot the --json output; exit-code matrix; assert the key never appears in any output or error.

VERIFY
pnpm verify
````

### 4.2 GitHub Action

````text
TASK 4.2 — JavaScript GitHub Action (apps/action)

DO
- action.yml: name, description, branding, runs.using = node24 (GitHub is retiring node20; if unsure, use node24 and flag it in docs/LIVE_VERIFICATION.md), main = dist/index.js.
- Inputs: apk-path (glob, required), api-key (required), fail-on (default not-registered), extra-fingerprints (newline-separated, e.g. F-Droid's signing key), job-summary (default true).
- Outputs: package-name, fingerprints, state, results-json.
- Implementation: @actions/core only; find APKs by glob (node:fs glob or minimal matcher), parse with core parseApk via fileSource, check fingerprints with the status client, write a job summary table with guidance, set outputs, call core.setSecret(api-key) first, fail per fail-on.
- Bundle with esbuild into dist/index.js (ESM or CJS as required by the runtime), commit dist/. Add CI step "dist is up to date": rebuild and `git diff --exit-code apps/action/dist`.
- apps/action/README.md with a usage example and a note that registration status of AAB uploads to Google Play is handled by Play and this action targets distributable APKs.

TESTS
Mock @actions/core and the client; assert setSecret is called first, outputs, failure modes.

VERIFY
pnpm verify
````

### 4.3 Release pipeline (optional publish)

````text
TASK 4.3 — Release workflow

DO
- .github/workflows/release.yml on tag v*: verify, build, create a GitHub Release with notes, `npm publish --provenance --access public` for @devverify/core and devverify (permissions: contents: write, id-token: write). Skip publish steps if the repository variable PUBLISH_NPM != 'true'.
- Move the floating major tag (v1) for the Action after each release.
- docs/RELEASING.md: the HUMAN steps (npm trusted publisher setup, package name availability, tag procedure).

VERIFY
pnpm verify
````

---

## Phase 5 — Browser APK tool

### 5.1 Browser source and worker

````text
TASK 5.1 — Blob-backed RandomAccessSource and parsing worker

DO
- packages/core/src/browser.ts (separate entry `@devverify/core/browser`): blobSource(blob: Blob): RandomAccessSource using blob.slice(offset, offset+length).arrayBuffer(); reject reads past size.
- apps/site/src/workers/apk-worker.ts: receives {type:'parse', file}, runs parseApk, posts {type:'progress', bytesRead}, then {type:'result', result} or {type:'error', code, message}. Enforces a maximum file size of 4 GiB and rejects non-ZIP quickly.
- Tests (Vitest): blobSource against Node's Blob; worker message protocol with the worker function factored so it can be unit-tested without a real Worker; a counting test proving a 600 MiB synthetic virtual blob parses reading < 4 MiB.

VERIFY
pnpm verify
````

### 5.2 Tool page UI

````text
TASK 5.2 — /tools/apk-fingerprint/ page

DO
- Astro page + Preact island. CSP <meta http-equiv="Content-Security-Policy"> allowing: default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; worker-src 'self' blob:; base-uri 'none'; form-action 'none'.
- UI: drag-and-drop + file picker (accept .apk), progress, result card: package name, versionCode/versionName, each signer fingerprint with scheme badges (v1/v2/v3/v3.1), copy buttons for hex and colon-uppercase formats, warnings (signers disagree, rotation lineage, no signature).
- "Check snapshot": after parsing, fetch /api/v1/apps.json (same-origin static file), look up the package, and show the tracked status with guidance; if not tracked, say so. Clearly state: the APK is never uploaded; the lookup runs locally against a downloaded snapshot.
- "Check with your own key": show a ready-to-copy curl command using $ANDROID_DEVID_STATUS_API_KEY as a placeholder. Never ask for or accept an API key in the browser.
- Works on mobile browsers; keyboard accessible; error states for non-APK files.

TESTS
Component logic tests; a test asserting the page HTML contains the CSP meta and that the island source contains no fetch of anything except same-origin static JSON.

VERIFY
pnpm verify
````

### 5.3 Browser e2e (optional)

````text
TASK 5.3 — Playwright e2e for the APK tool

DO
- Dev dependencies: @playwright/test, @axe-core/playwright. Separate script `pnpm test:e2e` (not part of pnpm verify). Serve apps/site/dist with a tiny static server.
- Tests: upload a synthetic APK fixture and assert the fingerprint; assert no network requests are made during parsing (intercept and fail on any request after file selection until the explicit snapshot lookup); run axe on /, /apps/, one app page, /methodology/, /tools/apk-fingerprint/ and fail on serious/critical violations.
- CI: separate non-blocking job first (continue-on-error), with browsers installed via `npx playwright install --with-deps chromium`.

VERIFY
pnpm test:e2e (if browsers are available in this environment; otherwise state so in the report)
````

---

## Phase 6 — Docs, hardening, operations

### 6.1 Documentation

````text
TASK 6.1 — README and docs

DO
- README.md: what/why in 5 lines, live site link placeholder, badge usage (copy-paste Markdown), dataset and API links, CLI and Action quickstarts, how it works (diagram in Mermaid), limitations, disclaimer, license, citation.
- docs/DATA_DICTIONARY.md, docs/CLI.md (if missing), docs/FAQ.md (is this official? how often updated? why is my app "registered, other key"? how do I dispute?), docs/CORRECTIONS.md.
- Keep all claims consistent with docs/ARCHITECTURE.md and the methodology page. Run the banned-phrase scan over all Markdown.

VERIFY
pnpm verify
````

### 6.2 Quality gates

````text
TASK 6.2 — Automated quality gates

DO
- scripts/check-secrets.ts: scan the repo (excluding node_modules, .git) and dist/ for Google API key patterns (/AIza[0-9A-Za-z_\-]{35}/) and for the literal env var assignment with a value; fail CI on any hit. Add to ci.yml.
- scripts/check-budgets.ts: JS size budgets (AppsTable island <= 30 KB gzip; APK tool <= 60 KB gzip excluding worker), HTML budget (app page <= 60 KB gzip), zero scripts on content pages.
- scripts/check-licenses.ts: allowlist (MIT, Apache-2.0, BSD-2/3, ISC, 0BSD, CC0, BlueOak-1.0.0) over production dependencies.
- CI: `pnpm audit --prod` as a non-blocking step; check-links, check-secrets, check-budgets, check-licenses as blocking steps.
- Add a coverage threshold for packages/core (lines >= 90% on apk/ and status/).

VERIFY
pnpm verify
````

### 6.3 Operations runbook

````text
TASK 6.3 — Runbook and monitoring

DO (docs/RUNBOOK.md)
- Scheduled workflow disabled or delayed: symptoms, how to re-enable (Settings -> Actions, or `gh workflow enable crawl.yml`), keepalive options, optional external heartbeat (HEALTHCHECK_URL) with a free monitor, manual dispatch.
- Quota: where to see usage in Google Cloud console, what a 429 means, how the crawler degrades.
- Rotating the API key (create new, update secret, delete old).
- Source format change (exit code 30): how to diagnose with scripts/describe-signer-index.ts and update the parser.
- Google API or policy change: what to re-check (docs rows in LIVE_VERIFICATION.md), who to notify, how to add a site-wide notice.
- Data branch squash procedure (scripts/squash-data-branch.sh) and rollback.
- Corrections and takedown handling: SLA language, how to add a per-package note (`data/notes.json` supported by the site: package -> note, shown on the app page) — implement notes support in apps/site if missing.
- Incident template.

VERIFY
pnpm verify
````

### 6.4 Adversarial review and fixes

````text
TASK 6.4 — Whole-repo audit

Act as an adversarial reviewer. Audit the repository for: (1) secret exposure paths (logs, errors, artifacts, browser bundles); (2) quota-overrun paths (retries, loops, concurrent workflow runs); (3) parser safety (integer overflow, unbounded allocation, malicious ZIP/DER/AXML); (4) wording and legal-rule violations on the site, CLI, Action, docs; (5) supply-chain risks (dependencies, lifecycle scripts, unpinned actions); (6) accessibility regressions; (7) any statement in docs that claims something verified when docs/LIVE_VERIFICATION.md says open.

DO
- Write docs/AUDIT.md: findings table (id, severity, location, description, fix status).
- Fix every high/critical finding in this task with tests. List the rest as follow-ups in docs/BACKLOG.md.
- Add regression tests for each fix.

VERIFY
pnpm verify
````

**Gate 3 (HUMAN):** enable Pages, run the crawl + deploy end to end, resolve all LIVE_VERIFICATION rows, rotate nothing yet, then launch.

---

## Phase 7 — Optional extensions

### 7.1 Additional package sources

````text
TASK 7.1 — More sources via the PackageSource interface

DO
- Add `source` values to the schema (migration: existing records default to 'fdroid').
- Implement an IzzyOnDroid adapter and a generic "F-Droid-style repo" adapter (index-v2/index-v1) that extracts package -> signer fingerprint(s). The exact index fields are NOT verified: be tolerant, use fixtures, add LIVE_VERIFICATION rows and a describe script like task 1.3.
- crawler: iterate sources; the per-source share of the daily budget is configurable (default proportional to unchecked records).
- Site: source badge and filter.

VERIFY
pnpm verify
````

### 7.2 Names and summaries from the F-Droid index

````text
TASK 7.2 — Metadata enrichment

DO
- Weekly workflow (cron, offset minutes) downloads index-v2.json, extracts package -> {name, summary} (default locale), writes data/names.ndjson. Plain JSON.parse is acceptable (runner memory); no streaming dependency.
- Site shows names, search covers names (rebuild MiniSearch index with name field).
- Tolerant parsing + fixture; LIVE_VERIFICATION row for the real shape.

VERIFY
pnpm verify
````

### 7.3 GitHub-release apps via HTTP Range

````text
TASK 7.3 — Source: curated GitHub releases using the same zero-full-download design

DO
- sources/github-apps.yml (curated list: owner/repo, optional asset-name regex). Parser for this file (zod).
- httpRangeSource(url, fetch): RandomAccessSource using Range requests (requires Accept-Ranges / 206 handling; fall back with a clear error if unsupported; cap total bytes read per APK).
- Adapter: GitHub API (GITHUB_TOKEN) to find the latest release APK assets, parse each with parseApk over httpRangeSource, emit package -> fingerprints.
- Quota: GitHub API calls are separate from the Status API budget; keep both bounded.
- Tests with injected fetch and synthetic APK bytes served with Range semantics.

VERIFY
pnpm verify
````

---

## Human-only checklist

| When | Step |
| --- | --- |
| Before 0.1 | Create repo, commit `AGENTS.md`, run the AGENTS sanity prompt |
| Gate 1 | Cross-check parser on 3 real APKs with `apksigner` |
| Before 2.4 goes live | Google Cloud project, enable Android Developer ID Status API, restricted API key, repo secret, read API terms, confirm billing is not required |
| Gate 2 | `scripts/bootstrap-data-branch.sh`, run live probes, fill `docs/LIVE_VERIFICATION.md`, dry-run then real crawl |
| Gate 3 | Enable Pages (Source: GitHub Actions), set `SITE_URL`, pin Actions by SHA, choose licenses, check npm names, post corrections contact |
| After launch | Monitor first 4 days of crawl coverage, answer corrections, re-check Google docs rows monthly |

## Repair and review prompts

````text
REPAIR
The previous task failed `pnpm verify`. Read the failing output, fix the root cause (do not weaken tests or lint rules), rerun `pnpm verify`, and report what was wrong.
````

````text
REVIEW
Review the diff of the last task against AGENTS.md. List violations of the non-negotiable rules first (secrets, offline tests, invented facts, quota, wording, dependencies), then correctness bugs, then missing tests. Do not change code; output findings with file:line.
````
