---
title: Toonkotsu
type: subsystem
created: 2026-11-02
updated: 2026-11-07
sources:
  - code: src/Toonkotsu/
  - code: test/unit/Toonkotsu.test.ts
  - ext: https://toonkotsu.com
verified_at: 9d2f1133
---

# Toonkotsu

## Reader crypto

- Pages are AES-CTR with a per-page key and nonce: the counter is the nonce's first 8 bytes
  followed by a 64-bit big-endian block index.
- The device's `crypto.subtle` has no AES-CTR (only GCM and CBC), so `decryptPage` in `utils.ts`
  is pure TypeScript. `crypto.subtle` is used only for SHA-256 and HMAC, which the device supports.
- `test/unit/Toonkotsu.test.ts` checks `decryptPage` against Node's AES-CTR for 128, 192 and
  256-bit keys and lengths crossing the 256-block boundary; a wrong counter fails 18 of 19 cases.
  `npm test` alone would not catch a regression here: its VM provides Node's full WebCrypto.

## Requests

- `fetchDiscoveryRanking` posts an object body (`network.ts`). The bridge encodes object bodies
  and turns `0` into `false`; `limit` is non-zero today, but any zero-valued browse parameter
  would be sent as `false`. Unverified on a device: send `JSON.stringify(body)` when next touched.
- Reader requests stay inside the WebView session (`executeInWebView`), which `npm test` cannot
  run; the reader is device-only verification.

## Webtoon flag, 2026-11-07

`MangaInfo.isWebtoon` (types alpha.93) comes from the series `type` (`manga`, `manhwa`, `manhua`, `oel`): true for manhwa, manhua and webtoon,
false otherwise, so the reader scrolls those vertically. Nothing extra is fetched for it.
