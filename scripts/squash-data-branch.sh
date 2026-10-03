#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--yes" ]]; then
  echo "Usage: bash scripts/squash-data-branch.sh --yes [remote]" >&2
  echo
  echo "WARNING: this replaces the entire data branch history with one commit."
  echo "WARNING: the operation force-pushes refs/heads/data."
  echo "WARNING: pass --yes explicitly to continue."
  exit 2
fi

remote="${2:-origin}"
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if ! git show-ref --verify --quiet refs/heads/data; then
  echo "Refusing to squash: local data branch does not exist." >&2
  exit 1
fi

git fetch "$remote" data >/dev/null

local_head="$(git rev-parse refs/heads/data)"
remote_ref="refs/remotes/${remote}/data"
remote_head="$(git rev-parse "$remote_ref")"

if [[ "$local_head" != "$remote_head" ]]; then
  echo "Refusing to squash: local data is not at the current remote head." >&2
  echo "Local:  $local_head"
  echo "Remote: $remote_head"
  echo "Update the data branch first, then run this script again." >&2
  exit 1
fi

name="$(git config user.name || true)"
email="$(git config user.email || true)"
if [[ -z "$name" || -z "$email" ]]; then
  echo "Refusing to squash: configure git user.name and user.email first." >&2
  exit 1
fi

echo
echo "============================================================"
echo "WARNING: DATA BRANCH HISTORY WILL BE REPLACED"
echo "Remote: $remote"
echo "Branch: data"
echo "Current commit: $local_head"
echo
echo "A new root commit will keep the current data tree and discard"
echo "all previous data-branch commit history."
echo "============================================================"
echo

tree="$(git rev-parse refs/heads/data^{tree})"
message="data: squash history $(date -u +%F)"
new_commit="$(git -c user.name="$name" -c user.email="$email" commit-tree "$tree" -m "$message")"

echo "New root commit: $new_commit"
git push --force "$remote" "$new_commit:refs/heads/data"

echo "Data branch history squashed successfully."
