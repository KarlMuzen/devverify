#!/usr/bin/env bash
set -euo pipefail

remote="${2:-origin}"

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if git show-ref --verify --quiet refs/heads/data; then
  echo "Refusing to create data: local data branch already exists." >&2
  exit 1
fi

if git show-ref --verify --quiet "refs/remotes/${remote}/data"; then
  echo "Refusing to create data: remote ${remote}/data already exists." >&2
  exit 1
fi

if git ls-remote --exit-code --heads "$remote" data >/dev/null 2>&1; then
  echo "Refusing to create data: remote ${remote}/data already exists." >&2
  exit 1
fi

tmp="$(mktemp -d)"
cleanup() {
  git worktree remove --force "$tmp" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

git worktree add --detach "$tmp" HEAD >/dev/null
git -C "$tmp" switch --orphan data >/dev/null
git -C "$tmp" rm -rf . >/dev/null 2>&1 || true
git -C "$tmp" clean -fdx >/dev/null

: > "${tmp}/apps.ndjson"
: > "${tmp}/events.ndjson"

cat > "${tmp}/timeseries.csv" <<'EOF'
date,total,registered,registered_other_key,not_registered,unknown
EOF

cat > "${tmp}/meta.json" <<'EOF'
{
  "schemaVersion": 1,
  "sources": {}
}
EOF

cat > "${tmp}/README.md" <<'EOF'
# devverify data branch

This branch is the git-backed dataset for devverify.

The crawler writes four deterministic data files:

- apps.ndjson — current per-package records.
- events.ndjson — append-only status transition events.
- timeseries.csv — daily aggregate counts.
- meta.json — schema version, source validators, and the last crawler run.

The branch is kept separate from main so the static site can consume a small,
deterministic data tree without putting runtime data behind a server.

This branch must never contain API keys, private certificates, keystores, or
other credentials. The only source data is public package/signing metadata and
derived Status API results.
EOF

git -C "$tmp" add apps.ndjson events.ndjson timeseries.csv meta.json README.md
git -C "$tmp" commit -m "data: initialize dataset branch"
git -C "$tmp" push "$remote" HEAD:refs/heads/data

echo "Created and pushed data branch."
