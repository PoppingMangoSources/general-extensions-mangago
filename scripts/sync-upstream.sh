#!/usr/bin/env bash
# Brings inkdex/general-extensions' new 0.9/stable commits into our 0.9/stable as a merge, so
# our history is never rewritten. It works on the local 0.9/stable branch itself; no extra branch.
# Our README, homepage theme, agent guides, skills, docs and scripts are kept; package.json and
# the lockfile follow upstream, with our own npm scripts added back. Keep a newer transitive
# security bump only by hand.
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
git checkout --quiet -B 0.9/stable origin/0.9/stable
ID=(-c user.name="Popmango Extensions" -c user.email="297959108+PoppingMangoSources@users.noreply.github.com" -c commit.gpgsign=false)
KEEP=(README.md AGENTS.md CLAUDE.md .claude .agents .github docs scripts .husky)
git "${ID[@]}" merge --no-ff --no-commit upstream/0.9/stable || true
for path in "${KEEP[@]}"; do
  git restore --source=HEAD --staged --worktree -- "$path" 2>/dev/null || true
done
git checkout --theirs -- package.json package-lock.json 2>/dev/null || true
# Re-add the npm scripts our tooling needs on top of upstream's package.json.
node -e '
  const fs = require("fs");
  const ours = JSON.parse(require("child_process").execSync("git show origin/0.9/stable:package.json", { encoding: "utf8" }));
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  pkg.scripts = { ...pkg.scripts, ...ours.scripts };
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
'
git add package.json package-lock.json
if git diff --name-only --diff-filter=U | grep -q .; then
  echo "Resolve the remaining conflicts, then: npm ci && npm run conformance && git commit" >&2
  git diff --name-only --diff-filter=U >&2
  exit 1
fi
GIT_AUTHOR_NAME="Popmango Extensions" GIT_AUTHOR_EMAIL="297959108+PoppingMangoSources@users.noreply.github.com" \
GIT_COMMITTER_NAME="Popmango Extensions" GIT_COMMITTER_EMAIL="297959108+PoppingMangoSources@users.noreply.github.com" \
  git "${ID[@]}" commit --quiet -m "chore: sync upstream 0.9/stable"
npm ci --silent
npm run --silent conformance
npx paperback-cli bundle >/dev/null
echo "Merged and verified on 0.9/stable. Compare our lockfile security bumps: git diff upstream/0.9/stable -- package-lock.json"
if [ "${1:-}" = "--push" ]; then
  git push origin 0.9/stable
fi
git checkout --quiet "$START"
