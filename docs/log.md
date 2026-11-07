# Wiki log

- 2026-11-02: wiki started. Pages for Toonkotsu, YaoiMe, source checks and upstream sync, from the
  toolchain read-through, 45 inkdex PR reviews and the first calibration of `check-sources.mjs`.
- 2026-11-02: source checks updated for commit metadata enforcement, automatic hook setup,
  shared validation before publishing and Stop-hook error handling; verified at `f3d531a`.
- 2026-11-03: Chikari page added for the unified listing/home/taxonomy API, separate novel
  reader routes and migration regression coverage, verified against public responses and captures.
- 2026-11-03: Chikari scanlator versions, seeded Random and Complete & Bingeable sections added;
  documented the explicit-scan fallback guard and section-visibility migration.
- 2026-11-03: Chikari novel reader corrected to preserve inline HTML emphasis while serializing
  valid XHTML, verified against This Game Is Too Realistic chapter 1600 on the site and API.
- 2026-11-03: BunManga canonical reader paths, ManhuaHot failover, catalog/paging differences and
  password locks documented, with live mirror reading and outage tests.
- 2026-11-03: XCOMIC edition merging and deduplication compared against Aidoku, Keiyoushi and
  Mana, with complete-list and stable-id regression coverage and live merged chapter reading.
- 2026-11-03: XCOMIC per-card merge-setting reads replaced with a per-page snapshot after a
  Discover slowdown report; added merged-chapter edition/team inclusion and exclusion filters.
- 2026-11-04: XCOMIC Latest now checks work-level genres/formats from the same response;
  square team labels omit edition ids and detail tags use resolved names. Unit and live checks passed.
- 2026-11-04: MGRead and Swarm pages added for public feeds, paging, filters and readers;
  LikeManga's final release archived on the existing dead-sources branch.
- 2026-11-04: Chapter-first, two-fact listing subtitles and compact hero metrics standardized
  for MGRead, Swarm and Chikari; YaoiMe coverless cards and sparse search metadata corrected.
- 2026-11-04: Complete attribution settings, hooks, checks, workflows and wiki synchronized
  between working and stable branches. Historical stable sync attribution removed while
  preserving its source tree and upstream merge parent; future syncs retain validation workflows.
- 2026-11-04: Swarm totals changed to full Chapters/type labels with canonical type casing;
  unknown generic labels omitted. One per uploader is now the default, selecting by site rank
  then numbered copy while preserving explicit settings and separate languages.
- 2026-11-05: Ranobes verification detection narrowed to the observed protection response.
  Sequential chapter requests replace the shared crawl cache. Added offline coverage for the
  cookie handoff, chapter refresh, cover URLs, and novel reader images.
- 2026-11-05: Restored Ranobes to one request per second after the iPhone log showed
  verification interrupting the faster chapter crawl.
- 2026-11-07: Toolchain moved to 1.0.0-alpha.94. platform.md records the alpha.93 managed-collection
  rework, `MangaInfo.isWebtoon`, and the URL and test-VM cookie `=` fixes; seven sources set
  `isWebtoon` from their site's own type field.
