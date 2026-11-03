---
title: BunManga
type: subsystem
created: 2026-11-03
updated: 2026-11-03
sources:
  - code: src/BunManga/network.ts
  - code: src/BunManga/parsers.ts
  - code: src/BunManga/main.ts
  - code: test/unit/BunManga.test.ts
  - ext: https://bunmanga.com/
  - ext: https://manhuahot.com/
verified_at: pending
---

# BunManga

## Canonical URLs and failover

Live probes on 2026-11-03 confirmed that `/manga/<slug>` and
`/manga/<slug>/<chapter>?style=list` return 301 redirects to the same paths with trailing
slashes. Node's default test transport follows those redirects; the device may return them
directly. Construct canonical title, chapter-list POST and reader URLs with trailing slashes.
This removes a transport difference; the original phone failure has not been reproduced on a
device.

Requests try the active host, then the other known host, retaining the working origin in app
state. Transport failures and unavailable HTTP statuses, including missing mirrored content,
try the other host. Invalid requests stop immediately. An unresolved Cloudflare challenge is
retained when both hosts fail. This source deliberately tries the other host on a challenge,
as requested by the owner. AJAX challenges open the host's root with the same complete Safari
identity used for API and page requests.

## These catalogs overlap

The sites share title and chapter slugs, verified with `the-night-watcher`, but have different
homepages and catalog counts. Neither should be treated as a complete copy of the other.
Persisted manga ids remain plain slugs and chapter ids remain chapter path components, so a
shared title can open on either host without a library migration. A title missing from both
still fails.

Search uses public `/page/<page>/` GET routes. BunManga serves 12 results per page; ManhuaHot
serves 10. Both expose a total in the search heading. Do not transfer BunManga's
`__madara_query_vars` / admin-AJAX pagination to ManhuaHot: its WordPress post ids and genre
slugs differ. The verified common genre aliases live in `MIRROR_GENRES`; unsupported genres
are not silently removed. Refresh the taxonomy promise when the active host changes.

ManhuaHot names its featured slider Top Daily, whereas BunManga names it Popular. The slider
mapper supports both; the mirror has no separate Top Daily sidebar widget.

## Password locks

The Night Watcher chapter 12 returned HTTP 403 with `.mhcl-lock-box` on both sites during
verification. This is a password-protected chapter, not a Cloudflare challenge or dead host.
Keep the chapter listed and report the access restriction instead of cycling through mirrors.
No password is guessed or submitted by the source.

## Verification

Unit tests cover canonical URLs, active-host reuse and recovery, public search pagination,
genre aliasing, Cloudflare failover, invalid requests, password locks and both slider headings.
The generated SDK baseline remains separate from these tests. Device reader and bypass flows
remain unverified.

Live testing passed the six SDK defaults, ManhuaHot search pages of 10 results each, shared-id
details and chapters, and The Night Watcher `chap-0` with two reader images. A simulated
BunManga transport outage also loaded ManhuaHot successfully.
