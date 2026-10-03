# AGENTS.md — devverify

Independent, zero-cost tracker and tooling for **Android developer verification** readiness, F-Droid first. Working name `devverify`; keep every name in `packages/core/src/brand.ts` so a rename is one edit.

## Non-negotiable rules

1. **Zero cost.** No servers, databases, or paid/login-gated services. Allowed: GitHub Actions + Pages, npm, shields.io (endpoint badges only). Cloudflare Pages only as a documented fallback host.
2. **Secrets.** The only secret is `ANDROID_DEVID_STATUS_API_KEY` (env var). Never commit, log, echo, snapshot, bundle into browser code, or put it in URLs or fixtures. Never ask for, read, or handle private keys or keystores: public certificates and fingerprints only.
3. **Offline by default.** Assume this sandbox has no internet. Tests never touch the network: inject `fetch`, use fixtures and fake timers. Live checks live in `scripts/live-*.ts`, run only when `LIVE=1`, and never in CI.
4. **No invented facts.** If an external format or behavior (F-Droid `signer-index.json` shape, Status API quirks, quota reset time) is not documented in `docs/` or a fixture: write a tolerant implementation, add a row to `docs/LIVE_VERIFICATION.md`, and say so in your report. Never present a guess as verified.
5. **Quota discipline.** Status API quota is 1,000 requests/day per project. Crawler budget defaults to 950 and is enforced by a `RequestBudget`. Every HTTP attempt, including retries, counts. HTTP 429 without a short `Retry-After` aborts the run. No unbounded loops or retries.
6. **Wording and legal.** Use "Android developer verification", "register a package name", "Android Developer Console" (never "ADC", never "claim a package name"). Say "not registered for the checked signing key", never "will be blocked". Show the non-affiliation disclaimer (not affiliated with or endorsed by Google or F-Droid) in the site footer, README, and CLI `--help`. Paraphrase official docs and link to them; never copy their text; no Google, Android, or F-Droid logos.
7. **Dependencies.** Prefer Node built-ins and web APIs (`util.parseArgs`, `fetch`, `crypto.subtle`, `DecompressionStream`). A new runtime dependency needs a short ADR in `docs/decisions/`. Allowed by default: zod, astro (+ preact, sitemap), minisearch, tsup, tsx, esbuild, vitest, eslint stack, prettier, @actions/core; playwright and @axe-core/playwright (dev only). No custom lifecycle scripts; allow dependency build scripts only for esbuild (and sharp if Astro needs it) via pnpm `onlyBuiltDependencies`. GitHub Actions: only official `actions/*`; use `corepack` for pnpm; reference by major tag and list them in `docs/LIVE_VERIFICATION.md` for SHA pinning by a human.

## Architecture

Static-first, "git as database". A scheduled crawler (GitHub Actions) reads F-Droid's signer index, calls the Android Developer ID Status API within quota, and commits sorted NDJSON to the `data` branch. Astro builds a static site, a JSON/CSV API, and shields.io endpoint badges; GitHub Pages hosts it. One shared TypeScript core feeds the crawler, the CLI/Action, and the browser APK tool. Details: `docs/ARCHITECTURE.md`.

## Layout

`packages/core` (@devverify/core: schemas, status client, sources, apk parser, guidance) · `packages/cli` (devverify) · `apps/crawler` · `apps/action` (JS action, bundled `dist/` committed) · `apps/site` (Astro) · `fixtures/` · `scripts/` · `docs/` · `data/` = git worktree of the `data` branch (gitignored on main).

## Commands

- `pnpm install`
- `pnpm verify` = lint + typecheck + test + build. Must pass before you finish.
- `pnpm test`, `pnpm --filter <pkg> <script>`
- `pnpm crawl -- --fake --dry-run` = offline end-to-end crawl.

## Standards

- TypeScript strict, ESM only, no `any` (use `unknown` + zod at boundaries), no non-null `!`, no default exports except config files and Astro.
- Business logic = pure functions with injected `now`, `fetch`, `random`, `sleep`. I/O only at the edges.
- Deterministic output: sorted keys, stable ordering, `\\n` line endings, trailing newline, timestamps only in designated fields.
- Typed errors with a stable `code`. Never swallow errors silently.
- Files under 300 lines. Comments explain why, not what. JSDoc on public API.

## Testing

Vitest. Every module ships tests in the same task. Table-driven cases, fixtures in `fixtures/`, golden files for serializers. Parser and status-derivation code: at least 90% line coverage. No real sleeping in tests: fake timers.

## Workflow

- One task = one focused change. Start with a plan of at most 10 bullets, then implement. Do not touch unrelated files or reformat the repo.
- Conventional commits. Update docs and tick `docs/PROGRESS.md` for the task you finish.
- If blocked or ambiguous: choose the safest reasonable default, state the assumption in the report, and continue. Ask only if the task would violate a rule above.

## Final report (always)

1. Summary · 2. Files added/changed · 3. Commands run with pass/fail · 4. Assumptions · 5. Needs human verification (mirror the rows added to `docs/LIVE_VERIFICATION.md`) · 6. Follow-ups.