---
title: Reader comparison and verification
type: operation
created: 2026-11-12
updated: 2026-11-12
sources:
  - code: src/
  - ext: https://github.com/keiyoushi/extensions-source
verified_at: pending
---

## Scope and evidence

Compared the chapter-opening and image-loading paths of all 29 Paperback sources
with Keiyoushi revision `7c6a7c2fc572e8d734f0626a86c5142203fd513c` on
2026-11-12. This is a reader comparison, not a full feature or filter audit.
Inherited readers were checked in their shared themes, rather than treating an
empty source subclass as the whole implementation. Source names differ for
LuaComic/LuaScans, MGRead/MgreadIo and VyManga/VyvyManga; the configured domains
confirm those matches. Four sources have no matching Keiyoushi implementation.

The broad live run produced 158 passing and 29 failing individual checks.
Several older generated-test files also contain custom checks, so those counts
are not 29 equal-sized baseline suites. A returned page list does not prove
image delivery. Specific failures and follow-up evidence are retained below;
blocked, paid, unavailable and device-only cases are not passes.

| Source         | Keiyoushi reader reference | Comparison and live result                                                                                                                                                                                                                                                                               |
| -------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BunManga       | Madara                     | Reading-content images and lazy attributes; live reader passed.                                                                                                                                                                                                                                          |
| Chikari        | Chikari                    | Series/chapter endpoint, scan edition parameter and page array; live reader passed.                                                                                                                                                                                                                      |
| Cocomic        | Madara                     | Reading-content page images; live reader passed. An extra latest-card metadata assertion failed outside the reader path.                                                                                                                                                                                 |
| KingOfShojo    | MangaThemesia              | Direct chapter path, HTML/reader-script images; live reader passed.                                                                                                                                                                                                                                      |
| LuaComic       | LuaScans / HeanCms         | Chapter list and reader API differ from our HTML path. Both old `/chapter/all/<slug>` and current paginated `/chapter/query?series_id=802` returned zero chapters for the first search result, Golden-Handed Baby. Its reader could not be exercised; changing endpoints alone does not establish a fix. |
| MGRead         | MgreadIo / InitManga       | Plain and encrypted reader HTML; live reader passed. Theme's newer protected-gallery variants need a matching live fixture before adding support.                                                                                                                                                        |
| MVLEMPYR       | None                       | Existing novel reader passed; no matching reference to port.                                                                                                                                                                                                                                             |
| MangaBerri     | None                       | Existing direct reader passed; no matching reference to port.                                                                                                                                                                                                                                            |
| MangaCherri    | MangaCherri                | Dedicated reader DOM images; live reader passed.                                                                                                                                                                                                                                                         |
| MangaHere      | MangaHere                  | Desktop reference uses deobfuscation and per-page endpoints; our mobile roll reader already returns the complete list. Live reader passed.                                                                                                                                                               |
| MangaHome      | MangaHome                  | Reference uses chapterfun page endpoints. Our reader test stopped at the site's licensed-content restriction for Namaikizakari. No license restriction was removed.                                                                                                                                      |
| MangaTown      | MangaTown                  | Both support long-strip images and paginated readers. Existing sequence/checkpoint optimization retained; live reader passed.                                                                                                                                                                            |
| MyReadingManga | MyReadingManga             | Entry-content image selection compared. Both root and `/page/1/` search requests returned HTTP 200 with a 195-byte `Site Unavailable` document; downstream reader unverified.                                                                                                                            |
| NovelArchive   | None                       | Existing novel API reader passed; no matching reference to port.                                                                                                                                                                                                                                         |
| NovelCool      | NovelCool                  | Reference follows partner reader pages; our mobile API returns reader content directly. Live reader passed. Fixed URL double-encoding with a percent-encoded path/signature regression input.                                                                                                            |
| Ranobes        | None                       | Browser verification prevented the live run; reader unverified.                                                                                                                                                                                                                                          |
| ReiManga       | ReiManga                   | Both use manifest-derived byte ranges for packed pages. Existing alpha.5 parser baseline passed; native pack image delivery remains subject to its documented CDN limitation.                                                                                                                            |
| RinkoComics    | RinkoComics                | Both previously selected only `img.chapter-image`. Added the live site's encoded canvas page list in Paperback and Mana; target chapter 2 returned 22 pages and first/last images downloaded. Baseline selected a different, paid chapter and remained blocked.                                          |
| RokariComics   | MangaThemesiaAlt           | Reference follows the chapter URL directly. Removed repeated list lookup for integer chapters while preserving old IDs and fallback lookup; same 16 pages with one request instead of two. Six baseline checks passed.                                                                                   |
| ScansGG        | ScansGG                    | Reference directly uses chapter-navigation API. Our reader also has HTML/browser fallbacks; live Cloudflare blocked search, so no fallback rewrite was justified.                                                                                                                                        |
| StoneScape     | StoneScape                 | Chapter-ID page API and page-number ordering; live reader passed.                                                                                                                                                                                                                                        |
| Swarm          | Swarm                      | Same encrypted `/api/sp` payload contract and missing-upload placeholder. Initial reader returned HTTP 500. Follow-up calls with both the reference's minimal payload and our full payload returned HTTP 200; no encryption change was needed.                                                           |
| TempleScan     | TempleScan                 | Both depend on site-executed reader state. The local Paperback runner cannot execute the required WebView; reader unverified.                                                                                                                                                                            |
| Toonkotsu      | Toonkotsu                  | Reader API, verification gate, page keys and CTR image path compared; live baseline passed. Device crypto remains independently tested in the app.                                                                                                                                                       |
| ValirScans     | VineTheme                  | Both read Flight image URLs. Exact reported image URL returned HTTP 200 under four header profiles; device 404 not reproduced. Updated Mana's stale reader-props selector; target probe passed 17 checks and sampled images.                                                                             |
| VioletScans    | MangaThemesia              | Reader-script images compared; live chapter-list request failed at the network, leaving reader unverified.                                                                                                                                                                                               |
| VyManga        | VyvyManga                  | Reference refreshes expiring outbound links; added the missing refresh while preserving saved IDs and rejecting ambiguous matches. Six baseline checks passed.                                                                                                                                           |
| XCOMIC         | XCOMIC                     | Same chapter GraphQL image array; live reader passed.                                                                                                                                                                                                                                                    |
| YaoiMe         | YaoiMe                     | Signed reader and sealed image hashes compared; browse returned HTTP 403, so downstream reader unverified.                                                                                                                                                                                               |

## Mana

Checked the 11-source catalogue's reader implementations as well. RinkoComics
and ValirScans required the fixes above. RokariComics already opens a saved
chapter path in one request; its target-title probe passed all 18 checks with
sampled images, so its source version was left unchanged.

The remaining reader paths were compared for analogous problems: FlameComics
already refreshes Next.js build IDs after a failed data request; MangaDex
requests a fresh AtHome server and falls back from missing saver images;
MangaFire selects its chapter/volume API; Mangago handles its reader image
sequence and descrambling; StoneScape requests chapter pages; Toonkotsu has
its verification and image-key handling; XCOMIC reads the GraphQL image array.
MangaUpdates is a metadata/tracking source rather than an image reader. Code
comparison alone is not a live or device pass for these sources.

The targeted Golden-Handed Baby probes passed: RinkoComics 14 checks / 22 pages,
ValirScans 17 checks / 50 pages, RokariComics 18 checks / 16 pages. Their image
checks fetched through the configured transport. Native app rendering, offline
downloads and restart persistence were not tested on a device.
