---
title: MangaHome
type: subsystem
created: 2026-11-08
updated: 2026-11-08
sources:
  - code: src/MangaHome/
  - code: test/unit/MangaHome.test.ts
  - ext: https://www.mangahome.com
verified_at: pending
---

# MangaHome

## Transport security

On 2026-11-08, the homepage returned HTTP `fmcdn.mangahere.com` cover URLs. The source
preserved those URLs, which iOS App Transport Security can reject before any response.
Upgrade HTTP URLs to HTTPS in the shared parser and request interceptor, including saved
cover requests. Preserve the hostname, path and query string. The older `chapterfun.ashx`
WebView reader also normalizes its resolved image URLs to HTTPS.

Offline regressions cover listing and detail covers, reader images and outgoing requests.
The generated live baseline selected Namaikizakari., whose chapters the site marks licensed.
Search and details passed; chapter list and reader were blocked by that site restriction.
A direct check of I'm Being Raised by Villains chapter 163 returned 91 HTTPS page URLs;
the first image returned HTTP 200 with image/jpeg. Ranked rows omit missing covers internally
until the existing detail lookup resolves them; only rows with a cover reach the app.
These results do not verify native reader rendering or iOS transport handling.
