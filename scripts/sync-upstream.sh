#!/usr/bin/env bash
# Brings inkdex/general-extensions' new 0.9/stable commits into our 0.9/stable as a merge, so
# our history is never rewritten. Our README and homepage theme are kept; package.json and the
# lockfile follow upstream, keeping a newer transitive security bump only by hand.
#
#   scripts/sync-upstream.sh [--push]
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
[ -z "$(git status --porcelain)" ] || { echo "commit or stash your changes first" >&2; exit 1; }
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/inkdex/general-extensions
git fetch --quiet origin 0.9/stable
git fetch --quiet upstream 0.9/stable

AHEAD=$(git rev-list --count origin/0.9/stable..upstream/0.9/stable)
if [ "$AHEAD" = 0 ]; then
  echo "0.9/stable already has every upstream commit."
  exit 0
fi
echo "Upstream has $AHEAD new commit(s):"
git log --oneline origin/0.9/stable..upstream/0.9/stable

START=$(git rev-parse --abbrev-ref HEAD)
git checkout --quiet -B sync/upstream-0.9-stable origin/0.9/stable
ID=(-c user.name="Popmango Extensions" -c user.email="297959108+PoppingMangoSources@users.noreply.github.com" -c commit.gpgsign=false)
if ! git "${ID[@]}" merge --no-ff --no-edit -m "chore: sync upstream 0.9/stable" upstream/0.9/stable; then
  git checkout --ours README.md 2>/dev/null || true
  git checkout --theirs package.json package-lock.json 2>/dev/null || true
  git add README.md package.json package-lock.json 2>/dev/null || true
  if git diff --name-only --diff-filter=U | grep -q .; then
    echo "Resolve the remaining conflicts, then: npm ci && npm run conformance && git commit" >&2
    git diff --name-only --diff-filter=U >&2
    exit 1
  fi
  git "${ID[@]}" commit --quiet --no-edit
fi
npm ci --silent
npm run --silent conformance
npx paperback-cli bundle >/dev/null
echo "Merged and verified on sync/upstream-0.9-stable. Compare our lockfile security bumps: git diff upstream/0.9/stable -- package-lock.json"
if [ "${1:-}" = "--push" ]; then
  git push origin sync/upstream-0.9-stable:0.9/stable
fi
git checkout --quiet "$START"
