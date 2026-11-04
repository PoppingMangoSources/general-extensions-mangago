---
title: MGRead
type: subsystem
created: 2026-11-04
updated: 2026-11-04
sources:
  - code: src/MGRead/
  - code: test/unit/MGRead.test.ts
  - ext: https://mgread.io
verified_at: pending
---

# MGRead

New source id `MGRead`, version `1.0.0-alpha.1`. LikeManga's final released implementation
is preserved on `0.9/dead-sources`; this source starts a separate library namespace.

## Discover and filters

Live responses checked 2026-11-04. Most Popular, Top Rated, Latest Updates, Top Follows and
Power Ranking use their named public pages, respectively `/manga-ranking/`,
`/top-rated-manga/`, `/recently-updated/`, `/top-follow/` and `/power-ranking/`.
`/page/N/` and the enabled next-page icon control pagination. Optional rating, views,
chapter number and timestamp are displayed only when present in the cards.

Top Manga's Day, Week and Month chips use the homepage's actual
`/wp-json/initmanga/v1/top-ranking?range=day|week|month` feed, not a similar catalog sort.
These are single snapshots. Chip taps open the matching native search result list.

Ranking and update cards omit taxonomy. Their routes ignore genre and age query parameters.
With global content-rating or genre exclusions active, one bulk
`/wp-json/wp/v2/manga?slug=...&_fields=slug,class_list&per_page=100` request resolves the
whole page's genres. Missing records are excluded, original order and unfiltered pagination
are retained, and no per-title requests are made. Default unfiltered rows cost one request;
filtered rows cost two. Rating classification follows the site's genre labels, rather than
claiming a separate age field that the bulk endpoint does not supply.

Advanced catalog search uses `/advanced-filter/` and `/advanced-filter/page/N/`, with the
site's genre, type, status, age, star range and ten sort choices. Text search uses the public
search endpoint; the site does not apply those catalog filters or sorts to text results.
Global exclusions still apply. Search highlight markup is removed from titles.

## Details and reading

Manga ids are encoded slugs. Chapter ids encode `manga-slug/chapter-slug`; they remain usable
without hidden lookup state. The complete chapter index uses the original manga id from
`#manga-title[data-id]`, not the different WordPress post id. It fetches the declared page
count in batches of three. Volumes are `0`; source timestamps without a timezone use UTC+7.
Locked chapters retain a label, can be hidden in settings, and throw a useful reader error.

Reader images prefer the actual lazy-image URL. Current public key grants and older salted
chapters use native AES-CBC and PBKDF2-SHA512 as required by each response. Anonymous key
requests omit a stale page nonce, which otherwise causes a cookie-check failure. Browser
verification requirements stop with an actionable error. Novel HTML preserves emphasis and
serializes valid XHTML, including self-closing void tags and numeric entities.

## Verification

Offline tests cover section types, exact chip endpoint, request bounds, global exclusions,
empty filtered-page continuation, chapter ids/dates, locked chapters, lazy images and XHTML.
Six baseline live tests and three extended feed/form/filter checks passed. The long-list
reader check loaded all 3,865 Martial Peak chapters and chapter 3862's 12 images, with the
first image returning HTTP 200. Ten offline regression tests passed. Native iOS layout and
reader presentation require a device check; server tests do not establish visual rendering.
