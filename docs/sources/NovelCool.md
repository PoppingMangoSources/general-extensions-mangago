---
title: NovelCool
type: subsystem
created: 2026-11-12
updated: 2026-11-12
sources:
  - code: src/NovelCool/
  - code: test/unit/NovelCool.test.ts
  - ext: https://novelcool.com
verified_at: pending
---

## Image URL escaping

The reader uses the mobile chapter API's `pic_list`, ordered by `order_id`.
Its URL resolver previously called `encodeURI` on an already encoded URL.
For example, `/a%20b.jpg?signature=a%2Fb%3D` became
`/a%2520b.jpg?signature=a%252Fb%253D`, changing both the resource path and
signed query value. This was confirmed with a regression input on 2026-11-12;
it is not a claim that the reported ValirScans URL has this problem.

The resolver now preserves existing escapes while encoding literal spaces.
Unit coverage includes absolute and protocol-relative images, encoded paths,
encoded signature values and HTML-escaped query separators. Saved IDs and
novel reading behavior are unchanged. Native rendering remains unverified.
