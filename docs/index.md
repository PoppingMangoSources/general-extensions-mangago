# Popmango Paperback sources: wiki

Per-source and operational knowledge. Rules for writing sources are in the root `AGENTS.md` /
`CLAUDE.md` and the paperback-extension skill (`references/standards.md`, `references/platform.md`);
this wiki's own rules are in [AGENTS.md](AGENTS.md).

## Start here

- Changing a source: its page under `sources/`, then the skill.
- Adding a check: [operations/source-checks.md](operations/source-checks.md).
- Bringing inkdex changes in: [operations/upstream-sync.md](operations/upstream-sync.md).

## sources

- [BunManga](sources/BunManga.md): canonical paths, ManhuaHot failover and password locks.
- [Chikari](sources/Chikari.md): shared comic/novel listings, separate reader routes and stable ids.
- [MGRead](sources/MGRead.md): ranking feeds, bulk taxonomy exclusions and protected readers.
- [MangaHere](sources/MangaHere.md): mobile roll reader, HTTPS image URLs and transport retries.
- [MangaHome](sources/MangaHome.md): HTTPS covers and legacy reader images.
- [MangaTown](sources/MangaTown.md): HTTPS covers, reader links and chapter images.
- [NovelArchive](sources/NovelArchive.md): native/mirror chapter IDs, genre filters and XML readers.
- [Ranobes](sources/Ranobes.md): verification responses, sequential chapter lists and novel XHTML.
- [ReiManga](sources/ReiManga.md): packed WebP readers, byte ranges and image delivery limits.
- [Swarm](sources/Swarm.md): period feeds, languages, upload versions and comic/novel reading.
- [Toonkotsu](sources/Toonkotsu.md): reader keys, WebView session, AES-CTR in TypeScript.
- [ValirScans](sources/ValirScans.md): Flight reader props, access flags and chapter images.
- [XCOMIC](sources/XCOMIC.md): edition merging, server deduplication and complete chapter lists.
- [YaoiMe](sources/YaoiMe.md): live filters, complete ranking lists, chapter variants and reader keys.

## operations

- [source-checks](operations/source-checks.md): the offline checker, its calibration, and the backlog.
- [upstream-sync](operations/upstream-sync.md): keeping our `0.9/stable` level with inkdex.

## history

- [log](log.md)
