---
title: MangaTown
type: subsystem
created: 2026-11-08
updated: 2026-11-09
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

## Interceptor request identity

Matched Kitty's MangaFox (`deeaea6`) on 2026-11-09, starting from `db931cf`.
Mutate the original request because the alpha.94 test runtime passes it to every interceptor;
a later cookie interceptor would otherwise discard returned-copy URL and header changes.
Tests use the SDK's `CookieStorageInterceptor` to cover that order. Keep our source interceptor last.
HTTP and protocol-relative image requests become HTTPS, and image referers use the site root.

Keep the manga-detail trailing slash, but leave `/search` slashless: `/search/` returns 404.
Native iOS transport handling and rendering still require a device check.
