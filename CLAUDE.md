@AGENTS.md

## Claude Code

- `.claude/settings.json` runs `scripts/agent-hooks.mjs`. Before the first edit to a source in a
  session it points you at the skill; when you try to finish, it blocks while a changed source
  fails `check-sources.mjs` or has no passing `scripts/review-source.sh` stamp for its current
  files. A second stop in the same turn only reports, so a live-site failure can be explained
  instead of looping. Do not edit around it: fix the source or say why the failure is the site.
- Personal settings go in `.claude/settings.local.json`, which is ignored.
