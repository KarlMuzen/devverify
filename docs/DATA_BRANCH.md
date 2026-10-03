# Data branch

The data branch is the repository's git-backed dataset. main contains code and
documentation; data contains only the public crawler dataset and its small
branch README.

## Local worktree

From the repository root:

git worktree add data data

This checks out the data branch into ./data without mixing generated data files
into the main working tree.

The crawler expects that path in the scheduled workflow:

node apps/crawler/dist/index.js --data-dir data --budget 950

## What the branch contains

- apps.ndjson — one current record per package.
- events.ndjson — append-only status transition events.
- timeseries.csv — daily status counts.
- meta.json — schema version, source validators, and the most recent run.
- README.md — branch-specific operating notes.

The files are validated by the shared @devverify/core schemas and written
deterministically by the DataStore. Do not put API keys, private keys, keystores,
or other credentials on this branch.

## Why it is separate

The project is static-first. GitHub Pages builds from deterministic data, while
the crawler is the only writer. Keeping generated data on its own branch keeps
main reviewable and lets site builds consume a stable snapshot.

## Squashing policy

Use bash scripts/squash-data-branch.sh --yes when the data branch history is
about 200 MB or larger, or as a monthly maintenance operation.

The script refuses to run without --yes, checks that local data matches the
current remote head, creates a new root commit from the current tree, and
force-pushes that single commit to refs/heads/data.

Run the bootstrap script exactly once when the branch does not exist:

bash scripts/bootstrap-data-branch.sh

It is intentionally idempotent in the sense that it refuses to overwrite an
existing data branch.
