---
title: Ranobes WebView
type: subsystem
created: 2026-11-05
updated: 2026-11-05
sources:
  - code: src/RanobesWebView/
  - code: test/unit/RanobesWebView.test.ts
  - ext: https://ranobes.net
verified_at: pending
---

# Ranobes WebView

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

The iPhone log shows separate verification requests for the homepage, updates, rankings, and
completed titles. The source now reports only one verification request across concurrent calls.
Other calls stop with a normal pending-verification error. Completion or a source-settings reset
clears that state. The prompt can be requested again after one minute if it was dismissed.
The same log shows a top-level `return` syntax error from Paperback's verification WebView
on chapter-list page 44. Ranobes supplies the URL and headers to that flow. It supplies no script.

## Chapter lists and reader

The first `/chapters/<id>/` response supplies the page count, or the total and page size. Fetch
subsequent `/page/<n>/` routes sequentially in a WebView, up to 12 per invocation, at one start per second.
The SDK limiter admits each invocation and matching session cookies are supplied explicitly.
If a batch stops before the last requested page, retry that page once through the standard
request interceptor so Paperback can open verification for a challenge. On-device WebView
execution and clearance reuse need verification. Require chapter rows and valid pagination fields before continuing. An
interrupted crawl keeps the most recent partial list in memory for ten minutes. On retry, compare
the first and last saved page with the current site before reusing the saved pages. If either
has changed, fetch the list again from the first page. For two minutes after a successful multi-page load, reopening the same novel rechecks the first
page and reuses the remaining pages if the chapter links and pagination still match. A changed
first page or an expired snapshot triggers a fresh load.
On the reported title, the request to page 44 received HTTP 503. After verification, the next
load got HTTP 200 on pages 1, 2, 48, and 49. That rules out a fixed page-44 ceiling in the log.
The app's existing title and chapter URLs stay usable as IDs. A missing optional date is omitted
and a numbered prologue remains chapter zero.

Ordinary cards require a cover. Details for a saved coverless title use the published source icon,
verified as a PNG on 2026-11-05. The reader prefers the lazy-load image URL before serializing
XHTML, so a placeholder cannot hide a real GIF.

## Checks

The source's generated live suite lives under `src/tests/`. Offline tests cover the observed
challenge shape, concurrent prompt suppression, ordinary chapter text, scoped cookies, fresh
sequential lists, interrupted chapter lists, invalid payloads, and the cover and reader fixes.
A protection page at search blocks the remaining live
suite from obtaining a title. Ranking pagination and search's no-match response still need a
normal live response before changing their routes.

## Advanced Search

Tag, author, translator and publisher selectors preserve the site's option values and use
include, exclude and clear states. When the catalogue HTML does not expose the options,
the pickers use a small set of options observed on the site. This fallback is incomplete.
The 1–5 star range filters each result page by its published score and retains site pagination.
Vote count is separate and still uses `f.pvotenum` and `t.pvotenum`. Verification blocked
confirmation of the server-side star range, full option lists, Reviews, score-only sorting
and the separate MTL Reader filter.
