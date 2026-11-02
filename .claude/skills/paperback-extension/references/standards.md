# Inkdex merge standards

What a source must look like to merge into `inkdex/general-extensions`. Each rule carries its
evidence: a PR number is a review comment on that inkdex PR, a commit hash is a maintainer
cleanup on `upstream/0.9/stable`, **[policy]** is inkdex `CONTRIBUTING.md` or the PR template,
**[types]** is `@paperback/types` 1.0.0-alpha.92, and **[check]** means
`scripts/check-sources.mjs` enforces it. `evidence.md` quotes the comments.

When examples disagree, trust in this order: the live site's contract, written policy and
current review comments, a recent maintainer rewrite (FlameComics `e424b7c`, MangaFire
`225a974`, Comix `ad31e79`, Mangago `173bccd`, AllManga `c064615`), then older merged code. A
merge shows a patch was acceptable, not that every line around it is a standard.

## 1. Placement and branding

- A site on a generic theme (Madara, MangaStream/MangaReader, …) belongs in that theme's inkdex
  repository on its shared base. Only unique sites belong here. **[policy]** `handoff/` holds
  briefs for sources here that are on a theme.
- `name` in `pbconfig.ts` is the site's own name, exactly. The directory and class are
  PascalCase, without spaces. **[policy]**
- The icon is the site's logo, a square PNG at `static/icon.png`. **[policy] [check]**
- `description`: `Extension that pulls content from <domain>.` (every merged source).
- `language`: a lowercase IETF tag, or `multi`. **[check]** It is metadata only; a
  multi-language source still needs a language setting. **[types]**
- `contentRating` is the source's presence flag (`ADULT` if a real share of titles is adult),
  not a per-title floor. Set the right default before the PR, not after a report.
- `developers`: `[{ name: "Popmango", github: "https://github.com/PoppingMangoSources" }]`.
- Novel sources carry the badge
  `{ label: "Novel", textColor: "#ffffff", backgroundColor: "#3baf4b" }`; others `badges: []`.

## 2. Files

```
src/<Name>/
  main.ts       the ExtensionImpl class and `export const <Name> = new <Name>Extension()` [check]
  models.ts     types, constants, option arrays, SECTIONS; each DOMAIN/API_URL once [check]
  network.ts    every request and the PaperbackInterceptor subclass
  parsers.ts    HTML/JSON parsing and mappers
  forms.ts      Form/AdvancedSearchForm subclasses; forms/search.ts + forms/settings.ts once both exist
  utils.ts      heavy machinery only: decryption, descrambling, WebView capture
  pbconfig.ts   metadata, `satisfies ExtensionInfo`
  static/icon.png
src/tests/<Name>.ts   the generated baseline, unchanged [check]
```

- `main.ts` holds the class and nothing else: no queries, constants or fetches (#244).
- Constants are defined once, in `models.ts` (#156, #238 "Deduplicate with API_URL"). **[check]**
- Any canonical file may become a directory; a directory holding one file is a file
  (`utils/` with one module is `utils.ts`). Names like `helpers.ts`, `interceptors.ts` or
  `genres.ts` appear only in older sources. **[check, note]**
- Very large sources use `implementations/<capability>/` plus `services/network.ts` (Atsumaru,
  MangaDex). Do not start a source that way.
- The repository's `src/utils/` is for code several sources share; it holds `state.ts`
  (`getState(key, default)`). **[policy]**
- Every implementation file starts with `/* SPDX-License-Identifier: GPL-3.0-or-later */` and
  `/* Copyright © 2026 Inkdex */`. **[check]**

## 3. Code shape

- Free functions for fetches and parsers. Classes only where the SDK needs them: the
  `ExtensionImpl`, the `PaperbackInterceptor`, forms. No `Api`/`Parser`/service classes and no
  base classes for sharing helpers (#185; `e424b7c` deleted `FlameApi`/`FlameParser`).
- One declaration style per file. Arrow constants are the written preference and what
  FlameComics, HiveToons and Mgeko use; niclimcy's Mangago rewrite uses `function`. **[check, note]**
- No request state on the instance: handlers run out of order and race (#185).
- No wrapper whose body renames, unwraps, adds `?? default` or delegates one call; no wrapper of
  a wrapper (#156). Inline it.
- A constant or mapper used once is written where it is used (#238). Consolidate mappers only
  when several call sites share them.
- Delete dead code, unused exports and branches no call site takes.
- Use `cheerio` for HTML, never hand parsing (#156). Type selections as
  `cheerio.Cheerio<AnyNode>`; never `any`. **[check]**
- Use `@paperback/types` directly; never re-export or re-wrap it (#156). **[check]** Build paths
  with its `URL` class (#156; #120 removed a custom URL builder).
- Default `query.metadata` once with a full object, then read its fields (#152):
  `const metadata = query.metadata ?? { genres: [], statuses: [] }`.
- `try/catch` only around what throws (network, `JSON.parse`, `decodeURIComponent`). No catch
  that only rethrows `String(e)` (#152). **[check]** An empty catch needs a comment saying why
  the data is optional (Roliascan). **[check]**
- Comments say why, briefly. No boilerplate (#238 "remove comments like this"), no dividers
  **[check]**, no JSDoc narration, no commented-out code.
- No `console.*` in a source. **[check]** Errors the user needs are thrown with a message and
  `{ cause }`.
- Names match what they hold: a form named for artists does not say author (#185); a field is
  spelled as the API spells it (#142). Locals do not shadow globals (`data`, not `json`).

## 4. Requests and Cloudflare

- Every request goes through `Application.scheduleRequest`, so interceptors, the limiter and
  cookies apply. **[check]** One fetch helper per payload kind (`fetchJSON<T>(url)`,
  `fetchHtml`) checks `response.status !== 200` (a 2xx range is a note **[check]**), decodes with
  `Application.arrayBufferToUTF8String`, and parses.
- Rate limit every source: strict 1/s, balanced 3/s, loose 10/s. **[policy]**
  `new BasicRateLimiter("<id>", { numberOfRequests, bufferInterval, ignoreImages: true })`. No
  hand-rolled pacing or timers (`173bccd` deleted one).
- `interceptRequest` sets `referer` and `user-agent` (`await Application.getDefaultUserAgent()`),
  plus `origin` and an `accept` matching the resource where the site needs them.
- Detect Cloudflare once, in `interceptResponse` (`cf-mitigated: challenge`, or a 403 with the
  challenge page), and throw `new CloudflareError({ url, method, headers })` for the challenged
  request. A JSON API path cannot show the challenge: throw for the site root and say so.
- Never add Cloudflare handling the interceptor already does (#238). Every other catch on a
  request path rethrows `CloudflareError`.
- `cloudflareBypassCompleted(request, cookies, localStorage)` stores the cookies the site needs
  (the `cf*` pair for static sites; all of them for session-bound apps) in a
  `CookieStorageInterceptor({ storage: "stateManager" })`, and resets memo promises.
  `saveCloudflareBypassCookies` is deprecated (`75274b7`). **[types] [check]**
- A source with both bypass and chapters surfaces a challenge from `processTitlesForUpdates`
  before parallel updates start (MangaDot `5d56623`).

## 5. Discover, search and pagination

- `getDiscoverSectionItems` is a thin switch (or map) on `section.id` delegating to private
  handlers; one parameterised handler covers sections that differ by a token (MangaFire).
- Section ids, state keys and sort options are `as const` objects in `models.ts`.
- **One request per section.** Never fetch details per card (HiveToons cleanup: 9 requests down
  to 1). Drop a field the listing lacks, or widen the query; never fan out. **[check, note]**
- Pagination comes from the API's own signal (cursor, total, next link) or `EndOfPageResults`;
  no `.slice()` caps or invented page sizes. When filtering locally, `hasMore` comes from the
  unfiltered page. Advanced search paginates too (#214).
- Finite lists return no next page. Genre cards are `genresCarouselItem`s whose `searchQuery`
  re-enters search.
- Wire every filter, exclusions included where the API has them, in the site's own casing. If
  title search and filters cannot combine, say so in the form (#214).
- A tag on a details page round-trips into search: its id comes from the same function as the
  filter option (`173bccd`).
- Omit empty parameters; keep search metadata sparse.
- A setting that applies to every list (hide adult, hidden genres) is applied once at the
  dispatcher, not in each handler.
- `featuredCarouselItem.infoItems` is a tuple of one or two. **[types]**

## 6. Chapters and readers

- Use the site's real chapter id, never a count or a list position.
- Keep chapter numbers, volumes, groups and dates from the site; no `Date.now()` at parse time.
  **[check, note]**
- One access predicate (`isLocked || price > 0 || …`) serves lists, labels and reader guards
  (HiveToons `c9fa802`). Locked chapters read `(LOCKED)` after the title. Reader methods throw
  clear errors for locked, empty or malformed chapters.
- Build page lists from the payload's count and URL template; do not walk next-page links
  (`173bccd`).
- Novels return `{ type: "html", id, mangaId, html }` in a namespaced XHTML body with void
  elements closed, and set `mangaInfo.contentType = "novel"`. **[types]**
- `ChapterDetails` can also be `{ type: "file", format: "epub" | "pdf" | "cbz", request }`. **[types]**
- Pass images through untouched; GIFs animate (app r199). Discover cards prefer a still cover.

## 7. Ids

- Ids are self-sufficient: everything a later call needs is in the id, not `additionalInfo`.
- Sanitise with the canonical expression wherever ids are made:
  `const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;` (#214: "app does not accept id
  values outside of those in the regex"). **[check]**
- Encode and decode once; no `encodeId(decodeId(x))`. Changing an id format breaks saved
  libraries and needs a migration decision.

## 8. State and caching

- `Application.setState(value, key)`: value first. **[types] [check, note]**
- A taxonomy that does not really change is a constant, not a fetch (`173bccd`).
- A list that does change: a plain `fetchX()` memoised in a class field,
  `await (this.genresPromise ??= fetchGenres())`, reset in `cloudflareBypassCompleted`. No TTL
  machinery and no in-memory `Map` caches (HiveToons cleanup).
- A TTL is for a value that really expires, such as a signed token (MangaFire's VRF cache).
- Call `Application.invalidateDiscoverSections()` from any setting that changes Discover.
- Settings accessors are named for the value (`getSafeMode()`) and live in the forms layer. The
  `FormState` class pattern is rejected (#156). **[check]** Do not pass the extension into a
  form; move its get and set into the form (#156).

## 9. Forms and text

- `SelectRow` takes `items` and `layout`; `options` is deprecated. **[types]** niclimcy's
  MangaFire still passes `options`, so it is a note, but write `items`. **[check, note]**
- `maxItemCount` matches the selection (1 for a single choice). Row callbacks are
  `Application.Selector(this as Form, "handleX")` on a real async method.
- Tri-state genres use `TriStateSelectRow`.
- Functional text is text first: `Locked`, `English`. `★ 8.9` is fine. MangaFire's flag emoji
  are merged, so emoji are a note, but add no lock emoji. **[check, note]**
- Run scraped text through `Application.decodeHTMLEntities` (`3cc4d2b` replaced every
  `decodeHTML`).

## 10. Tests, versions and commits

- `src/tests/<Name>.ts` is exactly what `npx paperback-cli test --generate <Name>` writes: one
  `registerDefaultTests(suite, Source, sourceInfo)`, no custom cases and no seeded titles (#238
  "no need to define custom manga for test suite"). **[check]**
- Every change to a source bumps `version` (`1.0.0-alpha.N`); a new source starts at `alpha.1`.
  **[policy] [check]**
- Conventional Commits, `type(Scope): summary` with the source as scope (`feat: Add <Name>` for
  a new one); Conventional Branch names (`feature/<name>`, `bugfix/<name>`). **[policy]**
- AI-assisted submission commits carry `Assisted-by: <Agent>:<model>` and the PR template's AI
  box is ticked; niclimcy's own commits carry the trailer (`173bccd`). **[policy]**
- Format a submission with upstream's oxfmt: a newer one reformats other files (#271).
  `scripts/pr-branch.sh` installs upstream's lockfile for this.
- A new source, removal, rename or domain change updates the README list. **[policy] [check]**
