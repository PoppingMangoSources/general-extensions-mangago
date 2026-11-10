---
title: XCOMIC
type: subsystem
created: 2026-11-03
updated: 2026-11-10
sources:
  - code: src/XCOMIC/models.ts
  - code: src/XCOMIC/network.ts
  - code: src/XCOMIC/main.ts
  - code: src/XCOMIC/parsers.ts
  - code: test/unit/XCOMIC.test.ts
  - ext: https://github.com/Aidoku-Community/sources/tree/main/sources/multi.xcomic
  - ext: https://github.com/keiyoushi/extensions-source/tree/main/src/all/xcomic
  - ext: https://github.com/PoppingMangoSources/popmango-extensions-mana/tree/main/src/XCOMIC
verified_at: 9d2f1133
---

# XCOMIC

## Editions and chapter uploads are separate choices

Compared the current Aidoku Community, Keiyoushi and Mana implementations on 2026-11-03.
Their useful shared behaviors are edition/team preservation, the server's unique/full chapter
lists, correct chapter languages and complete pagination. Keiyoushi uses title-based library
keys; Paperback's existing edition keys must remain unchanged.

`Merge editions` defaults on as of `1.0.0-alpha.83`, including existing installs. The setting
uses a new state key to reset the previous preference once; users can turn it off afterward
and that choice persists. Other saved settings and library IDs are unchanged. With it off, refreshing chapters makes only the opened
edition's chapter-list requests. With it on, `get_comicNode.data.title_titleNode.comicNodes`
supplies sibling editions. Keep the opened edition first, even after the language preference
changes. Add public, normal, nonempty siblings in the selected languages; request at most
three edition lists concurrently. Search returns one representative edition per title while
merging, and chapter lists name each team's version under the original saved manga id.

`Deduplicate chapters` defaults on. It selects `get_comic_chapterList_uniqList` with
`Select_Comic_ChapterList_UniqList`, page size 1000. Turning it off selects
`get_comic_chapterList_fullList` with `Select_Comic_ChapterList`, page size 600. Both responses
are aliased to `chapterList` and expose `paging.pages`, `paging.total` and `paging.next`.

Live queries for The Greatest Estate Developer edition `vg7ypp` returned 172 unique entries
and 182 full entries on 2026-11-03. Complete each edition's pagination, then check the raw
entry count against its total before filtering non-normal uploads. Fail an incomplete list
instead of publishing it as a complete refresh.

## Merged duplicate policy

Each chapter keeps its existing URL-path id. The reader resolves the global chapter id from
that path, so chapters from sibling editions need no change to the saved manga id. Retain
team version, translated language, volume and date; interleave editions by chapter number and
date.

With deduplication on, repeated editions of the same named team share one version label,
case-insensitively. For the same language, volume and chapter number, keep entries from the
first edition that supplies them. Preserve multiple parts within that edition, unnumbered
extras and other teams' translations. With deduplication off, retain every distinct upload.
Do not deduplicate across all teams by chapter number.
An importer such as `srcName=mpark` is not proof of a shared scanlator: unnamed editions keep
their entries even when that importer label matches.

## Further parity work

Source settings now expose Include and Exclude editions/teams as comma- or newline-separated
names or edition ids. Matching is exact and case-insensitive; blank Include allows every
otherwise eligible edition and Exclude wins conflicts. These filters apply only to merged
chapter lists; editing them does not reload Discover. Filter before requesting the lists, including the opened edition if explicitly
excluded. If nothing matches, throw a useful error instead of returning an apparently complete
empty refresh. An unnamed edition can be selected by id; importer labels are not team names.

Grouping controls from Mana could be added separately. The Aidoku/Mana title-level author,
artist and description fallbacks are also worth considering
when a comic edition lacks metadata; request those fields in the same GraphQL response.
Do not copy reader-specific caches, title-key migrations or unsupported reading-direction
fields into Paperback.

## Discover settings-read regression

The edition-controls change added merge-mode reads inside the title formatter for every card.
An identical 48-card fixture required 48 settings reads before that change, then 96 reads for
plain titles and 144 for names carrying a team suffix. These are native calls on a phone;
Node timing alone does not capture their cost.

Read title preferences once per card batch and pass the snapshot through the mappers.
The same fixture now needs two reads for 48 cards, with the same output for each setting.
Search also snapshots once per page. Discover's queries, number of cards and hero sizes remain
unchanged, and edition/team filters never run on its path. Regression tests assert the fixed
read count and that Discover makes no chapter-list or sibling-edition requests. Device load
time still requires verification.

## Verification

Unit coverage checks defaults, both endpoint modes, page completion, public/language edition
selection, stable reader ids and team/language/volume/extra preservation. The generated live
SDK baseline stays unchanged. Device settings persistence, grouping and layout need a phone
check.

Live testing passed the six SDK defaults, unique/full switching and merged edition reading.
The merged Asura Scans chapter `/chapter/jkrgp5` returned 40 images under the saved `vg7ypp`
manga id. Unit coverage additionally ensures unnamed editions sharing an importer are kept.

## Latest taxonomy and edition labels

Live responses checked on 2026-11-04 show that an edition's `genres` can omit genres and
formats carried by its work. Latest requests `comicNode.data.title_titleNode.data` inline,
then tests both `genre_ids` and `format_ids` alongside the edition's taxonomy. No detail
request is made per tile. Normalize both the selected exclusions and incoming taxonomy.

The current Aidoku Community helper appends `[Team]` from `subName` or an existing bracketed
suffix, without adding an edition id when two editions have the same label. Paperback now
follows that display convention; its saved edition ids remain distinct and unchanged.

Details use resolved `tagNodes.data.name`, preserving their wording, rather than displaying
opaque entries from `tags`. The repeated-team title, stable ids, readable tags, and missing
edition taxonomy are covered in unit tests. The six default live source checks passed for
1.0.0-alpha.81. Device rendering and end-to-end latency still need an app check.

## Webtoon flag, 2026-11-07

`MangaInfo.isWebtoon` (types alpha.93) comes from the comic's `type`: true for manhwa, manhua and webtoon,
false otherwise, so the reader scrolls those vertically. Nothing extra is fetched for it.
