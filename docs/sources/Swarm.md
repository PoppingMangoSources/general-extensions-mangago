---
title: Swarm
type: subsystem
created: 2026-11-04
updated: 2026-11-07
sources:
  - code: src/Swarm/
  - code: test/unit/Swarm.test.ts
  - ext: https://swarm.ws
verified_at: 9d2f1133
---

# Swarm

New source id `Swarm`, version `1.0.0-alpha.3`. Public site and API responses checked
2026-11-04. The icon is the site's own `/logo.png`.

## Discover

Most Popular uses `/api/analytics/popular?window=3m`, with true limit/offset pagination and
the original rank preserved after local filtering. Most Recent Popular chips select the same
endpoint's `7d` and `1m` windows. Views and chapter counts/numbers are shown when supplied.
Most Followed New Comics uses `/api/homepage?window=7d|1m|3m` and its `newComics` field.
This endpoint ignores offset and returns a 50-item snapshot; it must not invent later pages.

Latest Updates (Hot) and (New) use `/api/latest?filter=hot|new&page=N&limit=50` with real
chapter ids, numbers and source timestamps. Random uses `/api/random?limit=20` as a prominent
carousel. Novels use `/api/novel`; genres come from `/api/manga/genres` as native picker chips.
Each populated section makes one request; period chips need no request until selected.

## Search, languages and uploads

Browse uses `/api/manga/filtered`; text search uses `/api/comic/search`. Types, genres, tags,
start/end year ranges, minimum chapters and content choices follow the public parameter
contract. Option ids encode punctuation before sanitization, so labels such as `Boys' Love`
round-trip exactly. The site's text-search endpoint controls its own ordering.

Settings select chapter languages, content rating, all uploads/one per uploader/one per chapter,
and preferred or blocked uploader names. Language aliases normalize Korean and Latin American
Spanish across the API's inconsistent spelling. Preferences are read once per feed, never
per card. Local filtering retains the original server continuation, even for an empty page.
Upload selection sorts once and removes duplicate keys in one pass. The working catalog sorts
are Recently Updated and Title. The site's newer `created` sort returned HTTP 500 even without
filters on 2026-11-04, so that broken option is not exposed.

## Details, chapters and readers

Comic pages use their public server-component response with `rsc: 1`. The `initialData`
object contains title metadata and the site's chapter list. Legacy guessed JSON details and
chapter endpoints return 404 and are not used. The object parser understands strings and nested
braces, both in direct responses and embedded script records.

Comic manga ids are slugs; chapters keep their actual upload ids and uploader/rank versions.
Volumes are `0`; absent or sentinel dates stay absent. The list is limited to what the site
actually returns; completeness beyond the site's own chapter cap has not been established.

The comic reader sends the site's encrypted public payload to `/api/sp`, using native
SHA-256/AES-CBC and a fresh IV. Placeholder-only uploads produce a useful error rather than
broken images. Covers use the site's cover route or image proxy. Novels use a separate
`novel/slug` namespace and the public chapter-number reader route. Their text retains paragraph
spacing and inline emphasis while being serialized as valid XHTML.

## Verification

Offline tests cover the request encryption against an independent cipher, full-object parsing,
real upload ids, settings, language aliases, Discover types/windows, request bounds,
continuation and valid novel XHTML. Six baseline live tests and four extended checks passed, including all feeds, period chips,
forms and a filtered catalog search. Villain to the Rescue returned 694 English uploads;
Villain To Kill returned 2,328 uploads and chapter 374's 16 images, with the first image
returning HTTP 200. A novel with 378 chapters opened chapter 378 as XHTML. Nine offline
regression tests passed. Some individual uploads return the site's placeholder and require
choosing another version. Native iOS layout and reader rendering still require a device check.

## Listing presentation, 2026-11-04

Ordinary Discover/update/search subtitles now contain at most two facts, with the actual latest
chapter first. Mixed catalogs prefer type as the second fact; ratings or views are used when
appropriate and available. Known totals use `N Chs`, never a fabricated latest chapter.
Hero view counts are compact numbers without repeating their icon's meaning. All formatting
uses existing listing fields and adds no per-title network requests. Regression tests assert
actual outputs, missing fields, chapter zero and latest-versus-total distinctions.

The formatting revision passed 10 source regression tests and a live presentation check
across all Discover feeds and period chips. The default six live source tests also passed.

## Type labels and chapter defaults, 2026-11-04

Totals now use `68 Chapters | Manhwa`; latest numbers remain `Ch. 68 | Manhwa`.
Case-insensitive canonical type labels prefer `type`, then an explicit format in `demographic`,
genres or tags. Novel catalog records are known novels. Generic Comic/Other labels are omitted,
not promoted into a guessed Manga/Manhwa/Manhua type. The search API's `latest_chapter_number`
spelling is also supported. No per-title metadata lookups are added.

Live checks found no type fields in `/api/latest` or the homepage's inline latest rows. The
bulk `/api/manga/latest-chapters?mangaIds=...` endpoint supplies only latest numbers, not types.
Soul Land V's followed/search records have only `Comic`, empty genres/tags and no classification
metadata. These cards therefore show their chapter fact alone until the site supplies a type.

The chapter-list default is now One per uploader. Explicitly saved All uploads/One per chapter
choices remain unchanged. Numbered source copies such as `official2` belong to `official`.
Within each language/chapter/uploader, select the lowest site rank letter, with unranked copies
last; ties use the lowest copy suffix, with an unsuffixed name counting as copy 1. Keep the real
winning upload id and original uploader label. One per chapter additionally honors preferred
uploaders first. Blocking an uploader name blocks its numbered copies; an exact numbered name
can block only that copy. All uploads continues to expose every allowed upload.

This revision passed 13 offline source tests and all six baseline live tests. The captured
Villain to the Rescue response contains 694 English uploads; One per uploader keeps 573,
with the selected upload ids verified against the original response. Native iOS presentation
and settings interaction remain unverified without a device.

## Webtoon flag, 2026-11-07

`MangaInfo.isWebtoon` (types alpha.93) comes from the series payload's `type`: true for manhwa, manhua and webtoon,
false otherwise, so the reader scrolls those vertically. Nothing extra is fetched for it.
