---
title: MangaTown
type: subsystem
created: 2026-11-08
updated: 2026-11-08
sources:
  - code: src/MangaTown/
  - code: test/unit/MangaTown.test.ts
  - ext: https://www.mangatown.com
verified_at: pending
---

# MangaTown

## Transport security

On 2026-11-08, the homepage returned HTTP `fmcdn.mangahere.com` cover URLs. The source
preserved those URLs, which iOS App Transport Security can reject before any response.
Upgrade HTTP URLs to HTTPS in the shared parser and request interceptor, including saved
cover requests. Preserve the hostname, path and query string. The same parser handles
paginated reader links and chapter images.

Golden Kamui chapter 314 returned a whole-chapter viewer with protocol-relative
`zjcdn.mangahere.org` image URLs. Its first image returned HTTP 200 with image/jpeg over HTTPS.
Offline regressions cover listing and detail covers, reader links, images and outgoing requests.
All six generated live tests passed.
Native reader rendering and iOS transport handling remain unverified on a device.
