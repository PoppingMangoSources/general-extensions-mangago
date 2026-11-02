---
title: Upstream sync
type: operation
created: 2026-11-02
updated: 2026-11-02
sources:
  - code: scripts/sync-upstream.sh
verified_at: pending
---

# Upstream sync

Our `0.9/stable` mirrors inkdex `0.9/stable` plus our README and homepage theme. Bring new
upstream commits in with `scripts/sync-upstream.sh [--push]`: it merges (never rebases, so our
published history is not rewritten), keeps our README, takes upstream's `package.json` and
lockfile, then runs `npm ci`, conformance and a bundle.

## 2026-11-02

Merged 72 upstream commits (AllManga, HiveToons, Atsumaru novels, MangaFire CDN settings, Comix
removal, TypeScript 7) as `0f9cb57`. Conflicts: README (ours kept), package files (upstream
taken), `src/tests/AllManga.ts` (upstream). The lockfile kept our newer transitive `undici` by
editing only that entry: a full `npm update` also dropped `libc` fields from other packages.
