# Architecture

devverify is a static-first system organized around a scheduled data pipeline rather than a runtime backend.

## Pipeline

F-Droid indexes feed the scheduled crawler. The crawler exchanges bounded requests with the Google Status API, then writes the resulting dataset to the `data` branch. The Astro site consumes that branch at build time and produces static pages, public JSON/CSV data, and shields.io-compatible badge endpoints. GitHub Pages hosts the generated site.

The pipeline is:

`F-Droid indexes -> scheduled crawler <-> Google Status API -> data branch -> Astro static build -> GitHub Pages + badge endpoints`

The crawler is responsible for refreshing the tracked snapshot. The site does not perform live third-party lookups.

## Why there is no backend

The dataset changes daily, so the repository can publish a refreshed snapshot without serving application traffic. The planned Status API quota is 1,000 requests/day, which rules out using a backend to perform live package lookups at site-request time.

Keeping the published data static also makes builds, pages, badges, and API responses reproducible from a repository state.

## Shared TypeScript core

`packages/core` contains the reusable domain and parsing logic. The same core is used by the crawler, the CLI/Action, and the browser APK tool so package naming, fingerprints, status handling, parsing, and guidance remain consistent across interfaces.

I/O stays at the edges. Business logic is intended to remain deterministic and testable with injected dependencies.

## Repository layout

- `packages/core` — @devverify/core: schemas, status client, sources, APK parser, guidance.
- `packages/cli` — devverify command-line interface.
- `apps/crawler` — scheduled crawler.
- `apps/action` — JavaScript GitHub Action; bundled `dist/` is committed.
- `apps/site` — Astro static site.
- `fixtures/` — committed test fixtures.
- `scripts/` — maintenance and live-check scripts.
- `docs/` — architecture, decisions, verification, and operational documentation.
- `data/` — git worktree for the `data` branch; gitignored on `main`.

The project remains independent and is not affiliated with or endorsed by Google or F-Droid.
