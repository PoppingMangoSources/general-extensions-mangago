#!/usr/bin/env bash
# Builds an inkdex/general-extensions submission branch for one source, in its own worktree,
# from upstream/0.9/stable. Only src/<Name>/, src/tests/<Name>.ts and the README entry are
# taken from this repo; everything else (package.json, lockfile, formatter) is upstream's, so
# conformance runs with the versions the maintainers run.
#
#   scripts/pr-branch.sh <Name> -m "<commit subject>" (--assisted-by <Agent:model> | --no-ai) [--from <ref>] [--push]
#
# New source: subject "feat: Add <Name>", branch feature/<name>, version 1.0.0-alpha.1.
# Upstream source: subject "fix(<Name>): …", branch bugfix/<name>, version upstream's alpha + 1.
# It never opens a pull request; the person does, with the template's AI-assistance box.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
NAME=""
SUBJECT=""
TRAILER=""
NO_AI=0
FROM=HEAD
PUSH=0
while [ $# -gt 0 ]; do
  case "$1" in
    -m) SUBJECT=$2; shift 2 ;;
    --assisted-by) TRAILER="Assisted-by: $2"; shift 2 ;;
    --no-ai) NO_AI=1; shift ;;
    --from) FROM=$2; shift 2 ;;
    --push) PUSH=1; shift ;;
    -*) echo "unknown option $1" >&2; exit 2 ;;
    *) NAME=$1; shift ;;
  esac
done
[ -n "$NAME" ] && [ -n "$SUBJECT" ] || { sed -n '2,12p' "$0" >&2; exit 2; }
if [ -z "$TRAILER" ] && [ "$NO_AI" = 0 ]; then
  echo "Pass --assisted-by <Agent:model> (the PR template requires the trailer on AI-assisted commits) or --no-ai." >&2
  exit 2
fi
case "$(node -p 'process.versions.node.split(".")[0]')" in
  2[4-9]|[3-9][0-9]) ;;
  *) echo "Node 24+ is required (CI uses 24; tests need its globals). Try PATH=/opt/node24/bin:\$PATH." >&2; exit 2 ;;
esac

cd "$ROOT"
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/inkdex/general-extensions
git fetch --quiet upstream 0.9/stable
git cat-file -e "$FROM:src/$NAME/pbconfig.ts" 2>/dev/null || { echo "$FROM has no src/$NAME" >&2; exit 1; }

LOWER=$(echo "$NAME" | tr '[:upper:]' '[:lower:]')
if git cat-file -e "upstream/0.9/stable:src/$NAME/pbconfig.ts" 2>/dev/null; then
  BRANCH="bugfix/$LOWER"
  UPSTREAM_VERSION=$(git show "upstream/0.9/stable:src/$NAME/pbconfig.ts" | sed -nE 's/.*version: *"([^"]+)".*/\1/p')
  VERSION=$(echo "$UPSTREAM_VERSION" | awk -F'alpha.' '{ print $1 "alpha." $2 + 1 }')
else
  BRANCH="feature/$LOWER"
  VERSION="1.0.0-alpha.1"
fi

WORKTREE="${TMPDIR:-/tmp}/pb-submission-$NAME"
if [ -e "$WORKTREE" ]; then git worktree remove --force "$WORKTREE" 2>/dev/null || rm -rf "$WORKTREE"; fi
git worktree prune
git worktree add --quiet -B "$BRANCH" "$WORKTREE" upstream/0.9/stable

cd "$WORKTREE"
rm -rf "src/$NAME"
SHARED_FILES=()
if git -C "$ROOT" grep -q 'utils/listings' "$FROM" -- "src/$NAME"; then
  SHARED_FILES=(src/utils/listings.ts)
fi
git -C "$ROOT" archive "$FROM" "src/$NAME" "src/tests/$NAME.ts" "${SHARED_FILES[@]}" | tar -x -C "$WORKTREE"
sed -i -E "s/(version: *\")[^\"]+(\")/\1$VERSION\2/" "src/$NAME/pbconfig.ts"

if ! grep -q "\[$NAME\]" README.md; then
  URL=$(grep -rhoE '"https://[^"/]+[^"]*"' "src/$NAME/models.ts" "src/$NAME/main.ts" 2>/dev/null | head -1 | tr -d '"' | sed -E 's#^(https://[^/]+).*#\1#')
  node - "$NAME" "${URL:-https://example.invalid}" <<'NODE'
const fs = require("node:fs");
const [name, url] = process.argv.slice(2);
const lines = fs.readFileSync("README.md", "utf8").split("\n");
const entries = lines.map((line, i) => [line, i]).filter(([line]) => /^- \[[^\]]+\]\(/.test(line));
const after = entries.filter(([line]) => line.slice(3).toLowerCase() < name.toLowerCase()).pop() ?? [null, entries[0][1] - 1];
lines.splice(after[1] + 1, 0, `- [${name}](${url})`);
fs.writeFileSync("README.md", lines.join("\n"));
NODE
  echo "Added README entry - [$NAME](${URL:-?}). Check the URL is the site's home page."
fi

npm ci --silent
npx oxfmt "src/$NAME" "src/tests/$NAME.ts" README.md >/dev/null
npm run --silent conformance
node "$ROOT/scripts/check-sources.mjs" --root "$WORKTREE" "$NAME"
npm test --silent -- "$NAME" >/dev/null || true
node "$ROOT/scripts/check-tests.mjs" --report bundles/tests.json "$NAME" || {
  echo "Tests failed. If the failure is the live site or this sandbox's network, say so in the PR; otherwise fix the source first." >&2
  exit 1
}

git add -A "src/$NAME" "src/tests/$NAME.ts" README.md "${SHARED_FILES[@]}"
BODY=()
[ -n "$TRAILER" ] && BODY=(-m "$TRAILER")
GIT_AUTHOR_NAME="Popmango Extensions" GIT_AUTHOR_EMAIL="297959108+PoppingMangoSources@users.noreply.github.com" \
  git -c user.name="Popmango Extensions" -c user.email="297959108+PoppingMangoSources@users.noreply.github.com" \
  -c commit.gpgsign=false commit --quiet -m "$SUBJECT" "${BODY[@]}"
node "$ROOT/scripts/check-submission.mjs" --cwd "$WORKTREE" --source "$NAME"

echo "Built $BRANCH at $WORKTREE ($(git log -1 --format='%h %s'))."
if [ "$PUSH" = 1 ]; then
  git push --force-with-lease origin "$BRANCH"
  echo "Pushed. Open the PR against inkdex/general-extensions 0.9/stable and fill in its template."
else
  echo "Not pushed. Re-run with --push, or push $BRANCH yourself."
fi
