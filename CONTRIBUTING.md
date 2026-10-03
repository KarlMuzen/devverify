# Contributing to devverify

## Setup

Use Node 22 or newer and pnpm through Corepack.

```sh
corepack enable
pnpm install
pnpm verify
```

The repository is an offline-first TypeScript monorepo. Tests must not depend on live network access.

## Tasks and pull requests

Work follows the task order in `CODEX_BUILD_PLAN.md`. One task is one focused change with one working branch and one pull request. Do not combine unrelated tasks or create parallel feature branches.

Before a pull request is opened, run `pnpm verify`, add or update tests for the change, update documentation when required, and check that no secrets or private signing material are present.

For wording and legal requirements, follow the root `AGENTS.md` rules exactly.
