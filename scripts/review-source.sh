#!/usr/bin/env bash
# The one review command for a source: types, lint and format, the source rules against the
# base branch, the merged-pattern comparison, the live tests read from their report, and the
# self-review checklist. Records a stamp the Claude Code Stop hook checks.
#
#   scripts/review-source.sh <Name> [--base origin/0.9/test] [--skip-tests]
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
NAME=""
BASE=origin/0.9/test
SKIP_TESTS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE=$2; shift 2 ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    *) NAME=$1; shift ;;
  esac
done
[ -n "$NAME" ] || { sed -n '2,6p' "$0" >&2; exit 2; }
cd "$ROOT"
[ -d "src/$NAME" ] || { echo "no src/$NAME" >&2; exit 2; }
case "$(node -p 'process.versions.node.split(".")[0]')" in
  2[4-9]|[3-9][0-9]) ;;
  *) echo "Node 24+ is required (CI uses 24; the tests need its globals). Try PATH=/opt/node24/bin:\$PATH." >&2; exit 2 ;;
esac

STATUS=pass
step() {
  echo
  echo "== $1"
  shift
  "$@" || STATUS=fail
}

MERGE_BASE=$(git merge-base HEAD "$BASE" 2>/dev/null || echo HEAD)
step "types" npm run --silent tsc
step "lint" npx oxlint --type-aware --deny-warnings "src/$NAME" "src/tests/$NAME.ts"
step "format" npx oxfmt --check "src/$NAME" "src/tests/$NAME.ts"
step "source rules (base $BASE)" node scripts/check-sources.mjs --base "$MERGE_BASE" "$NAME"
echo
echo "== merged patterns (read each feature's newest example before keeping a different shape)"
node scripts/upstream-usage.mjs "$NAME" || true
if [ "$SKIP_TESTS" = 0 ]; then
  echo
  echo "== live tests"
  npm test --silent -- "$NAME" >/dev/null 2>&1 || true
  node scripts/check-tests.mjs "$NAME" || STATUS=fail
else
  echo
  echo "== live tests skipped: the review is recorded as unverified"
  STATUS=fail
fi

echo
echo "== read against the diff (git diff $MERGE_BASE -- src/$NAME):"
sed -n 's/^- \*\*\(.*\)\*\*.*/- [ ] \1/p' .claude/skills/paperback-extension/references/review.md

node scripts/agent-hooks.mjs stamp "$NAME" "$STATUS"
echo
echo "Review of $NAME: $STATUS (stamped). Report what was exercised: source version, title, chapter, and anything only a device can show."
[ "$STATUS" = pass ]
