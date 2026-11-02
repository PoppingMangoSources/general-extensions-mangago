---
title: YaoiMe
type: subsystem
created: 2026-11-02
updated: 2026-11-02
sources:
  - code: src/YaoiMe/forms.ts
verified_at: a33af20
---

# YaoiMe

## Advanced search metadata (open)

`getSearchQueryMetadata` (`forms.ts`, about line 593) returns every field as `value || undefined`
or `cond ? value : undefined`. `Metadata` crosses the bridge as a raw value, and kodama's
repository recorded a production crash from exactly this shape ("Expected value of type
`JSValue`, found `nil`"). `check-sources.mjs` fails it as `metadata-undefined` (20 keys).

Not yet reproduced on a device here. Fix by adding only the keys that have a value, bump the
version, and confirm on a device that submitting the form with empty fields searches.
