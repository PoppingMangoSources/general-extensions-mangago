---
title: Ranobes
type: subsystem
created: 2026-11-05
updated: 2026-11-05
sources:
  - code: src/Ranobes/
  - code: test/unit/Ranobes.test.ts
  - ext: https://ranobes.net
verified_at: pending
---

# Ranobes

## Verification and cookies

On 2026-11-05 the public homepage and a paginated chapter list returned HTTP 503 with
`server: ddos-guard` in a browser. The chapter response had a `vb-captcha-shell` element and no
chapter data. A separate browser showed the image-matching prompt. The HTTP proxy can replace
the server header, so the detector recognizes the verification element on 403 or 503 responses.
The explicit `cf-mitigated: challenge` header still opens the SDK verification flow.

The resolution request uses the response URL and the same request headers as ordinary browsing.
Keep the cookies returned by Paperback within the SDK store's domain and path scopes. Session
cookies without an expiry are available to the active store and are dropped when it reloads from
state. A fixture verifies cookie forwarding after the callback. Completion of the prompt and the
first successful native retry require a device check.

## Chapter lists and reader

The first `/chapters/<id>/` response supplies the page count, or the total and page size. Fetch
subsequent `/page/<n>/` routes sequentially under the SDK limiter, which starts one non-image
request per second. Require chapter rows and valid pagination fields before continuing. An
interrupted crawl restarts at page 1 because newer chapters can shift the page boundaries.
The app's existing title and chapter URLs stay usable as IDs. A missing optional date is omitted
and a numbered prologue remains chapter zero.

Ordinary cards require a cover. Details for a saved coverless title use the published source icon,
verified as a PNG on 2026-11-05. The reader prefers the lazy-load image URL before serializing
XHTML, so a placeholder cannot hide a real GIF.

## Checks

The source's generated live suite lives under `src/tests/`. Offline tests cover the observed
challenge shape, ordinary chapter text, scoped cookies, fresh sequential lists, invalid chapter
payloads, and the cover and reader fixes. A protection page at search blocks the remaining live
suite from obtaining a title. Ranking pagination and search's no-match response still need a
normal live response before changing their routes.
