---
title: Cocomic
type: subsystem
created: 2026-11-21
updated: 2026-11-21
sources:
  - code: src/Cocomic/
  - code: test/unit/Cocomic.test.ts
  - ext: https://cocomic.co
verified_at: pending
---

## November 21 redesign

The installed source remains here while its current Madara child theme uses a
custom homepage, details and reader. No source ID or saved slug is renamed.

Home hero uses `.mobile-hero-slide`; the desktop `.hero-slide` supplements its
synopsis when available. Desktop has fewer slides, so missing descriptions are
omitted rather than fetched. Rails use `.mobile-swimlane-section`, heading
`.swimlane-heading` and `.mobile-swimlane-card`. Order: Trending, Trending Now,
Latest Updates, Popular Manga, New Releases, Genres. Chapter and rating are the
two subtitle facts; updates use native timestamps. A coming-soon card may link
its chapter label to the series itself; it is not a valid chapter ID.

Details now use `.asura-series-title`, `.asura-poster-img`,
`.asura-synopsis-content`, `.asura-badge-star`, `.asura-genre-tag`, and author
and artist chips. The redesigned score is out of ten; the old template score
is out of five. Normalize only the details rating; listing ratings are shown
as the site provides them. Do not mix the two scales.

Chapters still load via POST `/manga/<slug>/ajax/chapters`. Paid entries remain
listed with a locked suffix and are refused before making reader requests.
Reader images use `.asura-stream-images img`. The verified chapter returns
absolute `cdn2.cocomic.co` image URLs directly. The reference client's conditional
404 retry for `/www/wwwroot/` changes the response status; Paperback's response
status is read-only, so no speculative response rewrite is shipped. Image delivery
for legacy `/www/wwwroot/` paths remains unverified.

Root search (`s`, `post_type=wp-manga`) still uses old search cards and genre
checkboxes. The new archive cards use `article.asura-card`; pagination exposes
`.asura-pagination a.next`. Fixed homepage rails have no pagination metadata.

Live checks: default suite 6/6; home hero 4 cards, Trending Now 8, Latest Updates
8, Popular Manga 20 and New Releases 8. I Love Older Women details, seven
chapters and chapter 7's six image URLs parsed successfully. Device rendering
and legacy image paths remain unverified.
