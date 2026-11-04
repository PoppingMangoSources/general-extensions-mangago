# docs/ wiki contract

This directory is a wiki kept by agents as work touches each area: linked Markdown pages, not
one long document. The root `AGENTS.md` / `CLAUDE.md` says how to work and the
paperback-extension skill holds the platform and merge rules; this wiki records what a
particular site does and the traps found there. Link to the skill instead of copying it.
`docs/AGENTS.md` and `docs/CLAUDE.md` are identical (`node scripts/sync-agent-docs.mjs`).

## Layout

```
docs/
  AGENTS.md, CLAUDE.md   this contract
  index.md               table of contents; read it first
  log.md                 append-only work log, newest last
  sources/<Name>.md      one page per source: endpoints, ids, paging, traps
  operations/            repository procedures (checks, upstream sync)
```

## Page format

```yaml
---
title: Page title
type: subsystem | operation | history
created: YYYY-MM-DD
updated: YYYY-MM-DD # the day the body changed
sources:
  - code: src/<Name>/
  - ext: https://site
verified_at: <commit> # the commit the page was checked against, or "pending"
---
```

## Rules

- A trap found while working on a source goes into its page in the same commit as the fix.
- Facts carry where they came from: a live response (with the date), a device test (app build,
  title, chapter), or code. Mark anything unverified as such.
- When code changes a page's subject, update the page and its `verified_at`; read only what
  changed since that commit (`git diff <verified_at> -- <paths>`).
- Add a line to `log.md` for each change to the wiki, and list new pages in `index.md`.
- No secrets, cookies, tokens or account data, and no full site responses: small, scrubbed
  excerpts only.
