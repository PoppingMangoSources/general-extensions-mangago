---
title: VyManga
type: subsystem
created: 2026-11-12
updated: 2026-11-12
sources:
  - code: src/VyManga/
  - code: test/unit/VyManga.test.ts
  - ext: https://mangavyvy.net
verified_at: pending
---

## Expiring chapter links

Compared the reader with the current Keiyoushi VyvyManga implementation on
2026-11-12. The series page supplies outbound URLs such as
`https://aovheroes.com/rds/br/rdsd?data=<expiring-value>` rather than permanent
chapter URLs. A link saved when chapters were listed can expire before reading.

The reader now reloads the series page to obtain the current link for the
saved chapter label. An exact URL match is preferred; otherwise only a unique
matching label is accepted. Missing or ambiguous matches request a chapter-list
refresh instead of opening a different upload. Saved manga and chapter IDs are
unchanged, including the ID returned in ChapterDetails.

Unit tests cover expired-to-current URL replacement, unchanged saved IDs,
missing chapters and ambiguous labels. Device rendering remains unverified.

The live reader for Karasugaoka Don't be shy!!, Vol.1 Chapter 6, returned 62
pages with the original saved ID. Its first sampled image downloaded as JPEG.
The last sampled URL returned a 195-byte `Site Unavailable` HTML document,
so that sample is unverified rather than an image-loading pass.
