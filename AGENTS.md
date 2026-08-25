# Contributor & Reviewer Guide

The authoritative standards for authoring, refactoring, and reviewing Paperback **0.9 SDK** extensions in this repository. Every source here targets a site with a unique, non-generic theme. Extensions must be lean, maintainable, and consistent with the conventions below — these encode both the written guidelines and the conventions maintainers enforce in review.

Target: Paperback 0.9 / `@paperback/types` v1.0.0-alpha (the `ExtensionImpl` API), on the `0.9/*` branches. NOT the old 0.8 `Source`/`APIWrapper` style. `@paperback/types` is alpha and shifts — verify exact signatures against the installed version and the target repo's `tsconfig.json` rather than assuming.

The supplied **Agent Guidelines & Extension Code Style** from niclimcy are authoritative review rules. Attributions identify supporting evidence; they do not make every line in a reference source a standard. **[review]** marks additional maintainer review direction, while **[policy]** is reserved for CONTRIBUTING, the PR template, or CI. Current reviewer direction outranks inferred conventions when they conflict.

---

## 1. Purpose & first principles

- **Pick the right repo before coding.** A site matching a recognized generic theme (MangaStream/MangaReader, Madara, etc.) belongs in that theme's inkdex repo, extending the shared generic base. A bespoke reimplementation of a themed site in general-extensions is a rejection. Only genuinely unique sites are bespoke here. See [Theme Placement](#8-theme-placement).
- **Verify the live contract first.** Inspect the real page/API response and confirm endpoints, query params, pagination fields, lock flags, delimiters, and error behavior before implementing or reviewing. Don't rely on copied reference implementations.
- **Follow a merged neighbor.** When a pattern is ambiguous, match a recently merged comparable source's file split, naming, and idioms rather than inventing your own. The stock `ContentTemplate` is an API demonstration, not a style model — it carries inline parsing, boilerplate comments, deprecated form props, and `"EN"` langCodes that these rules tell you to avoid.
- **Use this evidence order when examples disagree:** the verified live contract, current written policy and maintainer review direction, a recent approved comparable source, then older merged code. A merge proves that a patch was acceptable in its scope; it does not endorse every surrounding design choice. Do not copy a stale pattern merely because it exists on `stable`.
- **Review behavior and request cost, not just shape.** Count network requests; verify pagination, filtering, lock visibility, URL-paste search, content ratings, and error/fallback behavior.

### Reference selection

- Choose a reference by the same site contract and complexity. Compare behavior and boundaries; never rewrite a source line by line merely to resemble another source.
- Useful `0.9/stable` references include niclimcy's compact Mgeko and MangaFire sources, Sinon/Catta1997's LNori and MangaDot API/form patterns, and LucifersCircle's capability-sharded Atsumaru organization. MangaTaro and QiScans provide additional sharded examples. celarye's repository-wide tooling and generated-test work is also part of the merge standard.
- Re-check every example against the authoritative rules, newer review direction, and current SDK types. MangaDot is a strong API/form reference, and its persisted genre flow remains valid for that source. New or refactored caching still follows niclimcy's no-TTL state-plus-memo rule unless a reviewer approves a source-specific exception. If current types require a newer form prop name, modernize only that API surface while preserving valid behavior. MangaDex and Comix have specialized architectures and are not ordinary-source templates.
- HiveToons is a close reference for an API-backed novel source with session-memoized live genres: use its session promise, Cloudflare reset, and shared access predicate where the same contract applies. It is already merged and must not be changed during unrelated cleanup.

### Review evidence

Merged review threads and cleanup commits establish the concrete requests summarized in this guide:

- Remove console logs, start new sources at `alpha.1`, and keep fetch functions in `network.ts`.
- Avoid names confused with globals, keep shared constants in `models.ts`, and reserve utils for real functional helpers.
- Add licenses/README entries for new sources, avoid mutable request state and circular imports, and wire every exposed filter.
- Use `ExtensionImpl`, keep constants in models, and fold trivial utils into a cohesive parser or owning layer.
- Deduplicate constants, remove boilerplate comments/wrappers/redundant Cloudflare checks, and inline single-use data.
- Use IETF language tags, repository formatting, generated baseline tests, and separate conformance checks.
- Remove dead code, avoid low-value caching, consolidate meaningful mappers, and keep fetches in network.

**Maintainer cleanup passes are the strongest evidence available** — where a maintainer rewrote a
contributor's branch before merging, what they deleted is the rule. Recurring deletions:

- A featured carousel that took the top N of a listing and then fetched each card's details
  (`.slice(0, 8)` + `Promise.all(posts.map(fetchPostDetails))`) — replaced by mapping the listing
  payload directly, 9 requests down to 1, with real pagination and no cap (HiveToons).
- Service classes and thin util modules — `FlameApi`/`FlameParser` plus `utils/filter.ts` and
  `utils/pickers.ts` deleted in favour of free functions in `network.ts`/`parsers.ts`, along with
  banner dividers and JSDoc narration (FlameComics, −1215/+628).
- A TTL-cached scrape of a taxonomy that never really changes, replaced by a static constant
  (Mangago: `updateGenres(force)` + two state keys + `parseGenres` → `GENRE_OPTIONS`).
- Trivial wrappers and single-use mappers, inlined at their call sites (AllManga).
- `encodeId(decodeId(x))` round-trips, empty query params, and a lock predicate that required
  `isAccessible === true`.

The PR template, not an individual maintainer preference, makes source version bumps mandatory.

---

## 2. File Organization

### Canonical per-extension layout (flat — most sources)

| File                   | Holds                                                                   | Review rule                                                                    |
| ---------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `main.ts`              | extension class plus `export const <Name> = new <Name>Extension()`      | orchestration only                                                             |
| `models.ts`            | types, constants, data structures, search-metadata types, option arrays | data only; define each `DOMAIN`/`API_URL` once                                 |
| `network.ts`           | request helpers and `PaperbackInterceptor` subclasses                   | all site requests originate here                                               |
| `parsers.ts`           | Cheerio/JSON parsing and `toX` mappers/formatters                       | free functions or one cohesive parser class                                    |
| `forms.ts` or `forms/` | `Form`/`AdvancedSearchForm` subclasses and settings state               | split into `forms/search.ts` + `forms/settings.ts` once a settings form exists |
| `utils.ts` or `utils/` | substantial isolated machinery                                          | no constants, ordinary fetches, or trivial wrappers                            |
| `pbconfig.ts`          | metadata, default-exported `satisfies ExtensionInfo`                    | `name` matches site branding                                                   |
| `static/icon.png`      | source icon                                                             | square site-derived PNG                                                        |

- **Keep `main.ts` focused on orchestration.** Move `toX` mappers and formatters to `parsers.ts`, fetch functions to `network.ts`, and standalone data to `models.ts`. Cohesive private handler methods are appropriate on the extension class. [review]
- **Respect file-layer boundaries** [review]:
  - `models.ts` = types / constants / data structures only.
  - `network.ts` = fetch + interceptor.
  - `parsers.ts` = parsing and mappers.
  - `forms.ts` / `forms/` = `Form` subclasses and their settings state. Inline trivial `getState`/`setState` wrappers at their consumers; never move settings logic to utils.
  - `utils/` = heavy machinery only.
- New sources default to this flat set. A capability-sharded source may add established capability directories; any other top-level file needs a concrete ownership reason. Do not preserve a legacy filename merely because an older merged source has one.
- **Utils scope.** `utils/` is for substantial, isolated machinery such as descrambling, decryption, byte repair, or webview logic. An ordinary API fetch does not earn a util module. Fold thin filters, formatters, pickers, constants, and settings accessors into their owning layer. A single substantial helper belongs in `utils.ts`; do not create a one-file directory to influence GitHub's alphabetical tree display.

### Capability-sharded layout (large sources only)

Very large sources use `implementations/<capability>/` with the current capability names (`chapter-providing/`, `discover-section-providing/`, `manga-details-providing/`, `search-results-providing/`, `settings-form-providing/`, `shared/`). Each capability owns its `main.ts`/`models.ts`/`parsers.ts` plus `forms.ts`/`utils.ts` where relevant; the source retains top-level `main.ts`, `pbconfig.ts`, `static/icon.png`, and `services/network.ts`. Follow Atsumaru's current vocabulary rather than QiScans/MangaTaro's older shortened directory names.

Some merged sharded sources compose capabilities through provider classes and mixins. Treat that as existing source-specific architecture, not the default for new work: niclimcy's function-based rule still limits new classes to framework-required `ExtensionImpl` and `PaperbackInterceptor` subclasses unless current reviewer direction explicitly requires the sharded pattern.

### Function and class design

- Parser and API logic uses exported arrow functions (`parseX`, `buildX`, `toX`), with file-local `const` arrow helpers. [niclimcy] Merged sources vary on the declaration form outside `parsers.ts` — MangaFire uses `export async function fetchApi<T>(url)` and `export function getLanguages()`, Mgeko `export function getSafeMode()` — so `function` in `network.ts`/`forms/` is accepted; keep one form per file.
- **Settings accessors are named for the value, not the action:** `getSafeMode()`, `getLanguages()`, `getBrokenCdnPrefixes()`, `getHideAdultContent()`. They live in `forms.ts`/`forms/settings.ts` and are imported by `main.ts` — never a `utils/` module. (MangaDot keeps its accessors in `utils.ts`; that is a documented source-specific exception, not a pattern to copy.)
- Classes are limited to framework-required `ExtensionImpl` and `PaperbackInterceptor` subclasses. Do not introduce parser, API, base, or state-holder classes merely for namespacing or reuse. [niclimcy]
- Do not add an `Api` class for ordinary REST/Next.js GETs, or a base class just to share utility methods; use focused fetch helpers and explicit parameters. Existing classes in an older merged source are not permission to copy the pattern. [niclimcy]
- **A typed fetch helper takes a fully-built URL string, not a `Request`.** One `fetchApi<T>(url)` does the GET, status check, and JSON parse; callers pass a URL assembled by small `URL`-class builders (`novelsUrl(...segments)`, `novelsFeedUrl(segment, limit?)`) rather than interpolating path/query strings by hand. Wrap only the JSON parse in `try/catch` and surface the failing URL. (Matches MangaFire's `fetchApi`. Several older sources instead pass a `Request` object — the URL-string form is the target.)
- **Bind a flat source class to its config: `implements ExtensionImpl<typeof XConfig>`**, with `import type XConfig from "./pbconfig"`. Capability-mixin sources use the corresponding `Extension`/`Omit` form.
- **HTML sources get the same fetch helper, one layer down.** The HTML analog of the JSON `fetchApi<T>` destructures `Application.scheduleRequest({ url, method: "GET" })` as `[response, buffer]`, checks `response.status`, decodes the buffer with `Application.arrayBufferToUTF8String(buffer)`, then returns the string or `cheerio.load(...)` (the docs' minimal `fetchText`/`fetchJSON<T>` discard the response as `[, buffer]`). Do not inline that `scheduleRequest → arrayBufferToUTF8String` dance at each call site.
- **Always route requests through `Application.scheduleRequest`**, never a raw fetch — it is what lets interceptors, the rate limiter, and dynamic cookies apply. Model a stable JSON response shape as a `<Thing>Response` interface in `models.ts` and fetch it as `fetchJSON<ThatType>(url)`.

### Simplification

- Delete dead/uncalled code aggressively (builders, constants, types, helpers).
- Inline single-use constants and trivial wrappers (a body that just renames, `?? default`, unwraps, or delegates one call). Collapse wrapper-of-wrapper helpers. Return new objects rather than mutating inputs.
- **Delete the branch nothing takes.** An optional parameter whose alternate value no call site ever passes is dead code with a signature attached — AllManga's `makeRequest(query, variables, method: "POST" | "GET" = "POST")` carried a whole GET-with-query-params branch that nothing used, and both the parameter and the branch were cut. The same goes for a fallback guarding a path that never succeeds: replace the try-then-fall-back with the one path that works and a single line saying why the other was dropped.
- **A mapper with exactly one call site belongs at that call site.** `toSearchResultItem(card, rating)` used once was deleted and written as an object literal inside the one handler that built it (AllManga). This is the counterpart to the consolidation rule below: consolidate mappers used from several places, inline the ones used from one.
- **Magic numbers live in module-level `const`s, not class fields.** A `private readonly CANDIDATES_CACHE_TTL` / `PAGE_SIZE` on the extension class was hoisted to the module (FlameComics). Class fields are for interceptors, limiters, and memo promises.
- Consolidate structurally identical mappers when the helper has a domain purpose; do not replace them with a generic one-line wrapper.
- **Inline trivial separator-joins even when reused — don't hoist a generic joiner.** A subtitle/label built by `[a, b].filter((value): value is string => Boolean(value)).join(" • ")` is written inline at each call site, not abstracted into a generic `dotJoin(...parts)`/`joinWithBullet` helper; merged sources (HiveToons) repeat the inline form rather than share a joiner. Reach for a helper only when it bundles real logic (title-casing, clamping, rank/rating assembly), and then give it a **purpose** name (`formatSeriesSubtitle`, `statSubtitle`), never a generic "join" name.
- Prefer native array methods (`.map`/`.filter`/`.reduce`); `for...of` is also fine. Use `cheerio` for HTML — never hand-rolled parsing.
- **Define single-consumer option arrays in their final shape.** If a list feeds exactly one consumer (e.g. `getSortingOptions`), declare it as `{ id, label }` in `models.ts` and return it directly — don't store `{ id, value }` and remap it in `main.ts`. [review]
- **Don't thread state through functions that don't use it.** Pass a settings value only into the function that actually reads it, not down through `parseMangaDetails(...)`/parser params it ignores. [review]
- **Don't invent wrapper abstractions over the SDK** — mirror a reference source (AniList for GraphQL query building, Mgeko for error handling) instead of a home-grown wrapper. AniList lives in a different repo — `inkdex/tracker-extensions` at `0.9/stable/src/AniList` — not general-extensions. [review]

### Comments & naming

- Terse, non-obvious "why" comments only. **No boilerplate / "standard across all extensions" comments.** Document a shared pattern once at most, never per-file. No commented-out code (use a real `// TODO` or delete), decorative dividers, empty docblocks, memory-aid notes, or stray blank lines. Removing explanatory boilerplate is a recurring new-source review request. [review]
- **No JSDoc narration on ordinary members.** A `/** Rate-limit ourselves to be polite… */` block above a limiter, or `/** Check if cached data is still valid */` above `isCacheValid()`, restates the code and gets deleted; the FlameComics cleanup stripped every one. Keep a comment only where it records a non-obvious "why", and prefer a single `//` line above the declaration rather than inside its body.
- Clean, grammatical, typo-free names. Avoid local names visually confused with globals (`data`, not `json` beside `JSON`). PascalCase dirs/classes; ALL_CAPS option constants; kebab-case implementation subdirs.
- Name API payload records after their domain role (`Novel`, `NovelSource`, `ChapterItem`) and reserve the `Response` suffix for endpoint envelopes. Do not use or mix `Dto` suffixes within a source. Anything passed as search/discover metadata must `extend JSONObject`. [niclimcy]
- **A cross-cutting filter belongs at the dispatcher, not in every handler.** When one setting has to apply to every section and every search result (hide adult titles, hide chosen genres), apply it once where the dispatch happens — `getDiscoverSectionItems`/`getSearchResults` call a private `load…` that returns raw results, and the public method filters what comes back. Repeating the filter inside each handler is how paths get missed: NovelArchive's Top Rated, Most Chapters, and search all silently skipped it. Sources with no such setting (MangaFire, Mgeko) need no `load…` layer at all.
- **URL-returning helpers carry a `Url` suffix.** A `parse*`/`format*`/`fix*`/`to*` helper that returns an absolute URL string is named `parseCoverUrl` / `formatImageUrl` / `fixImageUrl` / `toAbsoluteUrl` — not `parseCover` / `imageFromElement` / `getImageSrc`. (Merged: MangaFire `fixImageUrl`, RoyalRoad `formatImageUrl`; our `parseCoverUrl`.)
- **Prefix unused interface-mandated params with `_`** (`_metadata`, `_response`, `_localStorage`) — or `void param;`, but keep one style per file, not both.
- Cheerio typing: root `$: cheerio.CheerioAPI`; elements `cheerio.Cheerio<AnyNode>` (`import type { AnyNode } from "domhandler"`). **Never `Cheerio<any>`.** (`Cheerio<Element>` from domhandler is off-spec — use `AnyNode`.)

### On-device runtime constraints

Extensions run in a JS runtime that is **not a browser** — several globals are missing or misbehave. Prefer the `Application.*` primitive and guard the rest:

- Decode bytes with `Application.arrayBufferToUTF8String`, not `TextDecoder` (not guaranteed on-device). Hash/crypto via `Application.crypto_*` / `crypto.subtle` — `new SubtleCrypto()` throws.
- `Application.base64Decode` / `base64Encode` may return **a string OR an ArrayBuffer** — handle both.
- `typeof`-guard `setTimeout`/`clearTimeout`/`URLSearchParams` before use; reach `Function` as `globalThis.Function`.
- The global `URL` polyfill mis-resolves a two-arg `new URL(absolute, base)` (folds a mirror host back to the base). Prefer the SDK `URL` class (single-arg) — `new URL(base).addPathComponent(...).setQueryItem(...)` — and string-parse absolute URLs instead of reconstructing them.

---

## 3. Discover, Search & Pagination

### Discover dispatch

- **`getDiscoverSectionItems` is a thin `section.id` switch** that delegates to focused handler methods. No inline fetch/parse/map in the dispatcher. [review] [policy]
- **`SECTIONS` is an `as const` object in `models.ts`.** No inline section-id string literals anywhere; reference `SECTIONS.POPULAR` etc. Prefer one grouped `as const` object over parallel `SECTION_*` constants. The same applies to `Application` state keys — centralize them in an `as const` object and derive the union type (`type X = (typeof KEYS)[keyof typeof KEYS]`). [review]
- **A `Record<sectionId, () => Promise<...>>` dispatch map is an accepted alternative to the switch** — either form is fine as long as the dispatcher itself does no inline fetch/parse/map.
- **Name a section handler `get<Name>SectionItems()`.** Mgeko's `getGenreSectionItems()` and HiveToons' five (`getPopularSectionItems`, `getGenresSectionItems`, `getHotReleasesSectionItems`, `getLatestUpdatesSectionItems`, `getNovelsSectionItems`) set the pattern; `get<Name>Section` without the suffix reads like it returns the `DiscoverSection` descriptor rather than its items. Mark them `private`.
- **Handler methods are not mandatory.** MangaFire has none — its `getDiscoverSectionItems` runs ~89 lines inline, delegating to free functions in `parsers.ts`/`network.ts`. Split a handler out when the dispatcher would otherwise carry fetch/parse/map logic, not reflexively.
- Finite taxonomy/genre sections return their items without next-page metadata. Do not invent pagination for a complete list.
- **Know the `DiscoverSectionItem.type` values:** `featuredCarouselItem`, `prominentCarouselItem`, `simpleCarouselItem`, `chapterUpdatesCarouselItem`, `genresCarouselItem`. A genres/tags section emits `genresCarouselItem`s whose embedded `searchQuery { title: "", metadata }` re-enters search rather than fetching. `featuredCarouselItem.infoItems` carry SF-Symbol `symbol` names (`star.fill`, `flame.fill`, `book.fill`, `eye.fill`).
- **Settings-toggled sections:** build `getDiscoverSections()` conditionally on `Application.getState("<section>_enabled") as boolean | undefined ?? true`, and call `Application.invalidateDiscoverSections()` whenever such a toggle changes.

### No per-item detail fan-out

- **Never fan out into one detail request per carousel/listing item** (`Promise.all(cards.map(getDetails))`). Build carousels/listings from the listing payload, which already carries the needed fields. An N+1 section stalls the whole carousel and amplifies rate-limit/Cloudflare failures. See the documented exception in [Project-Specific Deviations](#10-project-specific-deviations). [review]
- **Widen the query before you add a request.** On a GraphQL or field-selectable JSON API, ask the list endpoint for the field you're missing rather than fetching per item. AllManga's chapter-update cards derived their `chapterId` from `availableChapters.sub` (a count) until the maintainer added `availableChaptersDetail` to the same `LATEST_QUERY` selection set and read the real chapter identifier straight off the card — same one request, correct ids.
- **A missing field on the listing card is not a licence to fan out.** Drop the `infoItem` rather than fetch for it. HiveToons shipped a featured section that sliced to 8 and then fetched all 8 detail pages purely to fill `rating`/`status`; the maintainer deleted the slice and the fan-out and built the same cards from the query payload. If the field genuinely is not in any listing endpoint, either omit it or raise it before writing the fan-out.

### Search & pagination

- **Omit empty query params.** Never send placeholders like `searchTerm=""`, `s=""`, or `author=""`. Add an optional param only when it has a value. [review]
- **Use server-side filters when the API has them** — send both included and excluded genre IDs. Only crawl-and-filter client-side when the API genuinely lacks the filter. [review]
- **A tag shown on a details page must round-trip into search.** Derive the ids on `tagGroups` with the _same_ function that builds the filter's option ids, so tapping a tag actually filters. Mangago had a details-page `makeSafeId` producing a `-` form while `GENRE_OPTIONS` used `genreIdFromTitle`'s `_` form — every tapped tag silently returned nothing, and the fix was to delete the second slugifier and share the first. One id-derivation function per vocabulary, and check a tapped tag against the filter before calling it wired up.
- **Send filter values in the site's exact casing and spelling.** Copy a real filtered request off the live site and mirror its parameter names and value case (e.g. lowercase `genres_exclude` values, not Title Case). A case/spelling mismatch is silently ignored by the server, so the filter appears wired up but does nothing.
- **Pagination derives from the API contract.** Read incoming page metadata, request the configured page size, and return next-page metadata from `totalCount`/the site's cursor. Don't hardcode page 1, cap with `.slice()`, or use an arbitrary smaller page size unless the UI contract requires it.
- **Don't clamp a curated feed to a fixed count.** A curated endpoint (e.g. editor's choice) should return exactly what the site lists; make the `limit` optional and append it only when one is genuinely needed, so entries the site later adds or removes track automatically instead of being frozen at a hardcoded number.
- **`hasMore` derives from the UNFILTERED server count/length.** When filtering locally, filter first, then slice/page from the filtered candidate set. [review]
- **Keep search metadata sparse** — `getSearchQueryMetadata` returns only non-empty fields; no empty arrays or empty genre maps.
- **Default `query.metadata` once with a full object**, then read fields off it: `const meta = query.metadata ?? { genres: [], statuses: [], orderIsDescending: false }`. Avoid non-null assertions (`query.metadata!`) or per-field null checks. [review]
- **URL-paste lookup is an optional fast path.** Match only supported source URLs, encode the slug once, and return `undefined` when it can't resolve so ordinary text search continues. Do not use blanket error suppression on normal API/parser/reader paths.
- **Use the SDK's pagination sentinels.** Return the `EndOfPageResults` constant (or `undefined` next-page metadata) at the end instead of a hand-rolled flag; a `{ completed }` metadata field can short-circuit the next call; thread `collectedIds` through metadata to dedupe across pages when the site repeats entries. Build the `URL` with `.setQueryItem(key, values[])` (it accepts a `string[]`) for repeated params instead of indexed `key[0]`/`key[1]` keys.

### Chapters, access & locked content

- Build one shared predicate from the site's verified access fields and use it for filtering, labels, update cards, and reader guards. OR every authoritative indicator: `isLocked === true || isPermanentlyLocked === true || price > 0`. A false boolean must not override a positive price. Do not require `isAccessible === true` (unlocked chapters may omit it).
- A "show locked chapters" setting may reveal records marked locked, but must not bypass non-public status or unrelated access restrictions.
- If `Chapter` cannot carry access state, encode a reserved paid/locked marker in the chapter ID while preserving existing public IDs. `getChapterDetails` must recognize that marker and throw before making a request. Use `startsWith`/`endsWith` for reserved markers, not broad `includes`.
- A chapter-update card must open readable content. Select an unlocked chapter or omit the card; do not fall back to a paid chapter just to keep the section populated.
- **A chapter count is not a chapter id.** `chapterId: String(card.chapterCount)` only works while the site's numbering happens to be a contiguous `1..N`, and silently opens the wrong chapter (or 404s) the moment it isn't. Read the real identifier the listing exposes, and if the listing doesn't expose one, widen the query for it. Never emit a card with `chapterId: ""` as a placeholder — return `undefined` and filter the card out, which is what the flat/`flatMap` shape in the section handler is for.
- **Build the page list from the site's own count and URL template, don't walk it.** When the reader payload exposes a total (`total_pages`) and the image URLs follow a template, generate all of them at once; a next-page walk that fetches page 2 to learn about page 3 is N sequential requests, needs its own HTML cache and retry logic, and truncates when a mirror answers differently. Mangago's walk cost 228 lines of `readerHtml.ts` plus a cache module, and both were deleted once the template + `total_pages` route existed.
- Reader methods **throw clear errors** for coin locks, permanent locks, short-link locks, empty page lists, malformed payloads, and failed requests — see [Error Handling](#4-cloudflare--error-handling).

### User-facing state

- **Functional information is text first.** Do not place emoji, flag emoji, triangles, or other decorative Unicode icons in functional titles, settings, sorting labels, version labels, or errors. Write `Paid`, `Locked`, `18K views`, and `English` explicitly. A star immediately paired with a numeric rating (`★ 8.9`) is an accepted compact rating label. [review]
- SDK-native SF Symbols are appropriate in fields designed for them (for example `featuredCarouselItem.infoItems`) and must accompany meaningful text. Use `star.fill` with the numeric rating in featured cards. Typographic punctuation used as a separator is not an icon.
- Do not copy HiveToons' historical lock-emoji title marker. Its merged price fallback is useful evidence for authoritative lock detection, but the emoji is a legacy presentation detail and HiveToons itself is outside this branch's cleanup scope.

#### Text / novel chapters

- **Return an HTML chapter, not pages.** For a novel/light-novel/web-serial source, `getChapterDetails` returns `ChapterDetails { type: "html", id, mangaId, html }` instead of `pages: string[]`, and `mangaInfo.contentType` is set to `"novel"` (manga sources omit `contentType`). `mangaId`/`chapterId` are still the identifiers even for novels.
- **Wrap the body in a namespaced XHTML skeleton** the reader (Readium) accepts: `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${body}</body></html>`, with the chapter title as an `<h2>` heading. **Self-close void elements** (`<br>`, `<img>`, `<hr>`, …) — Readium's XHTML parser rejects them unclosed. `cheerio.load(html, null, false).html({ xml: true })` self-closes them; a hand source needs a `fixVoidElements` pass (keep the void-tag list in `models.ts`). Escape plain-text lines and normalize `&nbsp;`/NBSP.
- **Number serial chapters by list position** (`chapNum: index + 1`) when the title carries no number; mark the source's own chapters with a distinct `version`.
- **Mark novel sources in pbconfig** with `badges: [{ label: "Novel", textColor: "#ffffff", backgroundColor: "#3baf4b" }]`; manga sources use `badges: []`.

---

## 4. Cloudflare & Error Handling

### Never swallow meaningful failures

- **Every catch on a request/parse/reader path must re-throw Cloudflare and let lock/paid errors propagate.** In each such catch: `if (error instanceof CloudflareError) throw error;`. Never a blanket `catch {}` and never a `Promise.any`-style swallow that hides a coin/lock/paid/empty-reader error the user needs to see. [review]
- Errors that must reach the user are **thrown** with a useful message and the original preserved as `cause` (`new Error(msg, { cause })`) — never hidden in `console.log`/`console.error`. Keep the parsing try/catch tight. Request-level catches for deliberate retry/fallback/state cleanup are legitimate; logs for intentionally non-fatal background work are fine. The rule is "don't hide a failure the user needs," not "never catch a request."
- Reserve `try/catch` for operations that genuinely throw (`decodeURIComponent`, `new URL`, network). Do not wrap non-throwing SDK calls (`Application.setState`/`getState`).
- **No `try/catch` that only stringifies-and-rethrows** — `catch (e) { throw new Error(String(e)) }` is a 0.8-legacy tell; delete it and let the error propagate. Keep a catch only for genuine retry / fallback / state cleanup. [review]
- **Don't add per-call Cloudflare handling that `interceptResponse` already does.** The interceptor throws `CloudflareError` centrally; a second CF check inside `getChapterDetails`/`getChapters` is redundant — remove it. [review]

### Centralized Cloudflare detection

- **Detect the challenge once, in `interceptResponse`** — not via a scattered per-call `throwOnCF` flag. Throw with the _challenged request's_ url and method, not the bare domain: [review]

```ts
throw new CloudflareError({
  url: request.url,
  method: request.method ?? "GET",
  headers: { "user-agent": await Application.getDefaultUserAgent() },
});
```

- Prefer one shared detection: header `cf-mitigated === "challenge"` (optionally combined with a 403 and a challenge-title regex).
- **Exception for JSON-API sources:** when the challenge lands on an API/JSON path that can't render the interstitial, throw the `CloudflareError` to the site root (`\`${DOMAIN}/\``) instead of the API url — solving it there clears the clearance cookie domain-wide. Comment why (the API path can't display the challenge). This is the one sanctioned reason to deviate from "throw the challenged request's url."
- Use the current bypass hook `cloudflareBypassCompleted(request, cookies, localStorage)` (interface `CloudflareBypassRequestProviding`). **Never the deprecated `saveCloudflareBypassCookies`.**
- Persist the captured cookies. A `cf` / `_cf` / `__cf` prefix filter is the default for a **static** site behind pure Cloudflare:

```ts
async cloudflareBypassCompleted(request: Request, cookies: Cookie[], localStorage: Record<string, string>): Promise<void> {
  for (const c of cookies)
    if (c.name.startsWith("cf") || c.name.startsWith("_cf") || c.name.startsWith("__cf"))
      this.cookieStorageInterceptor.setCookie(c);
  // reset memoized session caches here — see §5
}
```

- **This filter is NOT universal — verify against the site.** A server-rendered app (Laravel, etc.) binds the challenge to server-side session cookies too: forwarding only `cf*` drops the session and every post-bypass request 403s. Forward **all** cookies for such sites (a Laravel site sets `<site>_session` plus `XSRF-TOKEN` alongside the `cf*` pair). A DDoS-Guard site names its cookies `__ddg*`, not `cf*`, so a `cf`-prefix filter would discard them entirely — filter by domain or forward all (Ranobes). Match the cookies the site actually sets.
- **Present one browser identity everywhere.** The clearance cookie a challenge webview earns is bound to the UA that solved it (full Mobile Safari), while `Application.getDefaultUserAgent()` returns a bare iOS WebView UA. If native requests send a different UA the clearance is rejected and the source loops on the challenge forever. Complete the missing Safari tokens once and use that same UA for both the `CloudflareError` and every request (see Ranobes `completeMobileSafariUserAgent`).
- **Mirror failover for multi-domain sites.** When a source is reachable through alternate domains that get blocked independently, keep an ordered mirror list, fall through to the next host when the current one fails, and remember the host that last worked so later requests skip dead mirrors (Ranobes ranobes.net ↔ ranobes.top). Re-throw `CloudflareError` instead of failing over — a challenge is not a dead host.

### Interceptors & rate limiting

- Register interceptors in `initialise()` via `<interceptor>.registerInterceptor()`. Request interceptors run in **registration order**; response interceptors run in **reverse** — place the rate limiter deliberately (no fixed "must be last" rule).
- Interceptor class name is unique per source (e.g. `KingOfShojoInterceptor`).
- Rate is a per-site choice — guideline presets are strict ≈1/s, balanced ≈3/s, loose ≈10/s; "adjust as needed."
- **Never hand-roll request pacing.** The limiter owns it. A module-level `lastFetchAt` plus a `paceReaderFetch()` that awaits `setTimeout` to enforce a minimum interval is a second, invisible rate limiter that fights the real one and relies on a global the on-device runtime doesn't guarantee — Mangago's was deleted along with the rest of its `utils/cache.ts`. Tune `numberOfRequests`/`bufferInterval` instead.
- **Construct the limiter as `new BasicRateLimiter("<id>", { numberOfRequests, bufferInterval, ignoreImages: true })`** — an inline class field with a stable string id. `ignoreImages: true` keeps page-image loads off the API budget. Field names are **not** standardized across maintainers (`globalRateLimiter`/`rateLimiter`, `requestManager`/`interceptor`) — match a neighbor, don't bikeshed.
- **`interceptRequest` stamps a baseline on every request:** set `referer` to the source root and `"user-agent"` to `await Application.getDefaultUserAgent()`. Add `origin` and a JSON `accept` header for API calls. Spread over the incoming request (`{ ...request, headers: { ...request.headers, ... } }`).
- **Send an `accept` profile that matches the resource kind**, not one blanket value: JSON for API calls, `text/html,application/xhtml+xml…` for page requests, `image/avif,image/webp,…` for images. Some endpoints content-negotiate and will 404 or refuse to redirect under the wrong `accept` (AllManga's page documents, NovelArchive's `/cover` redirect). Comment the branch when a specific profile is load-bearing.
- **Persist cookies with a dedicated `new CookieStorageInterceptor({ storage: "stateManager" })`**, registered in `initialise()` alongside the limiter and request interceptor; in `cloudflareBypassCompleted`, `.setCookie(c)` per incoming cookie (skip expired via `c.expires`). This is the store the `cf*`-filter snippet above writes into.
- Request body must match its `Content-Type` (URL-encoded string, not an object, for `x-www-form-urlencoded`).

---

## 5. Caching / Memoization

- **Memoized session caches use a class-level promise field**, filled with `??=`, awaited to dedupe concurrent section calls:

```ts
private genresPromise?: Promise<string[]>;
// ...
const genres = await (this.genresPromise ??= fetchGenres());
```

- **Reset volatile memos to `undefined` in `cloudflareBypassCompleted`**, and on a base-url change — on base-url change also call `Application.invalidateDiscoverSections()`.
- **Name the field `…Promise`**, never `…Cache` / `…Request` / `…Items`. Use `undefined`, never `null`.
- **A taxonomy that does not really change is a constant, not a fetch.** Before adding a genre/tag fetch, ask whether the list is stable. Mangago scraped `/genre/all/` behind a 48h TTL with two state keys, a `force` refresh path, a silent `catch` that kept the stale list, and a hardcoded seed to fall back on — all of it was deleted for a plain `GENRE_OPTIONS` constant in `models.ts`, which also removed a request from `getSettingsForm`, `getAdvancedSearchForm`, and the genres section. Fetch a taxonomy only when the site's own list demonstrably moves (HiveToons/NovelArchive fetch theirs; both use the memo promise, neither uses a TTL).
- **Derive option arrays once at module level, not per call.** `export const GENRE_OPTIONS = GENRES.map(...)` beats `export function getGenres()` that rebuilds the same array on every row render and every section build.
- Static scraped lists (genres/taxonomies) may persist in `Application` state; the memo promise remains scoped to the extension instance. A volatile homepage memo may self-clear after use.
- Store scraped lists in `Application` state without TTL/timestamp machinery, expose plain fetch functions returning `Promise<T>` without a catch unless the caller has a deliberate fallback, and deduplicate concurrent reads with the class-level memo promise. Reset the promise after Cloudflare bypass or a base-url change. [niclimcy]
- **A TTL is legitimate for a value that genuinely expires.** The no-TTL rule targets caching _stable_ data (taxonomies, genre lists) behind timestamp machinery. niclimcy's own MangaFire keeps `utils/cache.ts` with `CACHE_TTL_MS`, `cacheGet`/`cacheSet` and a module-level `let cachedHomeHtml` for a rotating VRF token — a credential that really does go stale. Ask what the value is: a list the site edits once a month is a constant or a memo promise; a signed token with a server-side lifetime may earn a TTL. Say which in a comment.
- **A version baked into a state key is a smell, not a cache strategy.** `"<source>-chapterjs:v3:"` prefixes exist so bumping the version force-misses the old entry — which means the cache had no way to know when it was stale. Either the value is stable enough to persist plainly or it shouldn't be persisted; both the prefix and the surrounding cache went when Mangago's `utils/cache.ts` was deleted.
- No low-value, context-bound caches: an in-memory `Map` dies with the JS context; drop caches for short-lived data or items already shadowed by an earlier check. No request-specific mutable state on the instance (races under out-of-order calls). Parallelize independent fetches with `Promise.all`.
- **`Application.setState(value, key)` takes the value FIRST, the key SECOND** — `getState(key)` takes the key alone. Reversing them silently writes to the wrong slot (a recurring real bug). Clear a value with `setState(undefined, key)`; namespace keys `<source>_<name>`; read as `(Application.getState(key) as T | undefined) ?? default`.
- **Call `Application.invalidateDiscoverSections()` from any settings handler that changes discover output** (section toggles, hidden genres, content-type) — not only on a base-url change. After a reset/toggle that changes the form itself, call `this.reloadForm()`.

---

## 6. IDs & Sanitization

- **Sanitize every id at every id-producing call site.** Paperback rejects ids containing characters outside its allowed set, and an unsanitized character (e.g. an apostrophe in a tag slug) crashes the app. Sources are self-contained, so each defines the same canonical constant rather than importing a shared module: [review]

  ```ts
  // Paperback rejects ids containing characters outside this set.
  const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;
  ```

  Keep this constant byte-identical across sources — case-preserving, global (`/g`), no Unicode (`u`) flag. Two sanctioned replacement modes over this one charset: **dash-replace** (`.replace(SAFE_ID_REGEX, "-")`, most sources) or **preserve-by-encoding** (a callback that returns `encodeURIComponent(c)` when it differs, else `"-"` — keeps more of the original, used by KingOfShojo/RinkoComics). Pick one per source and keep it stable — changing an id format breaks users' saved library entries. This is distinct from a **narrow slugifier** (`[^a-z0-9]+ → "-"`, used for human-readable tag/team slugs in OManga/ScansGG) — a different purpose, not the id sanitizer.

- **IDs must be unique and self-sufficient** — carry everything needed to re-fetch (e.g. keep the absolute mirror URL in the id) rather than stashing values in `additionalInfo`. Never derive a `chapterId` from a non-unique bare number.
- Encode/decode each id exactly once. Normalize URL-derived `chapterId`s — a stray leading slash wipes saved reading progress.
- **No `encodeId(decodeId(x))` round-trips.** Decode a URL-derived slug once into the value the API wants, encode once into the value you hand back as the id, and pass each to the layer that needs it — don't encode then immediately decode again to build the request (`encodeMangaId(decodeMangaId(slug))` was cut from HiveToons for exactly this).
- No legacy-migration / self-healing re-resolution loops for old id formats in new sources.

### Parsing correctness

- **Brace/JSON slicing over decoded payloads must be string-aware** — track `inString`/`escaped` so brackets inside string values don't desync bracket depth. Unescape only what the transport escaped. Parse only verified delimiters and field orders. [review]
- **Parse only verified delimiters.** Don't split titles/creator names on convenient punctuation (commas can be part of a title); use delimiters observed in the live payload (slash, pipe, newline).
- Avoid speculative cleanup — normalize whitespace and known placeholders, but don't strip site text with unverified regexes.
- **Strip a verified prefix; don't discard the field on a crude heuristic.** AllManga dropped any chapter title containing a digit (`notes && !/\d/.test(notes)`), which threw away every real title with a number in it. The fix was to strip the observed `[S3] Ep. 99 - ` prefix and keep the remainder when it still contains letters. Filter on what you have confirmed the site emits, and prefer trimming the known noise to rejecting the whole value.
- **Synthetic dates must be stable across fetches.** When the payload carries no chapter/update date, anchor ages to the title's own update time, or to a first-load timestamp persisted in `Application` state — never `Date.now()`/`new Date()` at parse time, which makes the whole list re-sort on every refresh.
- Reuse the API's base response type instead of re-declaring a narrower interface that only restates optional fields as required.
- One generic list parser (`parseMangaList`) returning a generic item shape; the section handler switches on item type and maps at the call site.

### Defaults & optionals

- **`?? default`, never `|| default`, where `0`/`""`/`false` is a valid value.** Use `value != null` or an explicit presence check when zero is meaningful, and use the correct default (`?? "or"`, not `?? true`). [review]
- Guard optional fields (`chapter.images ?? {}` before `Object.entries`). Never leak `(string | undefined)[]` into a `string[]` field — filter/guard `$(el).attr("src")` maps before assigning to `pages`.
- **Run scraped display text through `Application.decodeHTMLEntities(...)`** — titles, secondary titles, subtitles, synopsis, author/artist, chapter names — at the parser boundary.
- **Read cover/thumbnail URLs from lazy-load attrs first** (`data-src`/`data-lazy-src`/`data-cfsrc`/`srcset`) before the placeholder `src`.
- **Validate scraped JSON with a type-guard (`isX(v): v is X`) before casting**, rather than a blind `as X` on shape-uncertain payloads (e.g. Next.js flight data).
- **Source real chapter dates** from the site's own field (`<time datetime>`, epoch-millis) and keep the no-`Date.now()`-at-parse rule above.

---

## 7. pbconfig & Metadata

- **Version scheme `1.0.0-alpha.N`, bumped on every change.** Every modified existing source gets a bump (PR-template requirement); a new source starts at `alpha.1`; a revived source bumps from its old version, not a reset. [policy]
- **Consistent `capabilities` ordering** across sources. ALL_CAPS constants throughout. Each `SourceIntents` value obliges the class to implement its methods (the compiler enforces this via `ExtensionImpl<typeof pbconfig>`):

  | Capability                     | Required methods                                                                                      | Optional                                                                            |
  | ------------------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
  | `CHAPTER_PROVIDING`            | `getChapters`, `getChapterDetails`                                                                    | `processTitlesForUpdates`                                                           |
  | `DISCOVER_SECTION_PROVIDING`   | `getDiscoverSections`, `getDiscoverSectionItems`                                                      | —                                                                                   |
  | `SEARCH_RESULT_PROVIDING`      | `getSearchResults`                                                                                    | `getSortingOptions`, `getAdvancedSearchForm`                                        |
  | `SETTINGS_FORM_PROVIDING`      | `getSettingsForm`                                                                                     | —                                                                                   |
  | `CLOUDFLARE_BYPASS_PROVIDING`  | —                                                                                                     | `cloudflareBypassCompleted` (use this; `saveCloudflareBypassCookies` is deprecated) |
  | `PROGRESS_PROVIDING`           | `getMangaProgressManagementForm`, `getMangaProgress`, `processChapterReadActionQueue`                 | —                                                                                   |
  | `MANAGED_COLLECTION_PROVIDING` | `getManagedLibraryCollections`, `commitManagedCollectionChanges`, `getSourceMangaInManagedCollection` | —                                                                                   |

- **Single-line import:** `import { ContentRating, SourceIntents, type ExtensionInfo } from "@paperback/types";`.
- **Single consistent developers block:** `{ name: "Popmango", github: "https://github.com/PoppingMangoSources" }`. Real, useful support contact — no bare non-copyable URLs.
- `contentRating` and `language` are **per-site**. `language` is a valid IETF (BCP 47) tag — lowercase, no flags/uppercase (`en`, `es`, `zh-hans`, `multi`). Source-level `contentRating` is MATURE/ADULT if any meaningful subset is.
- **Set a correct default content rating up front** — a wrong/blurred default (source-level or a "hide adult" setting's default) is a recurring post-merge fix. Pick the sensible default when you write pbconfig/settings, not after a bug report.
- **Per-title `mangaInfo.contentRating`** comes from that title's own data, set once at the app-return boundary; source default only as fallback. This is distinct from the pbconfig source-level rating.
- **Derive it with one shared pure `contentRatingForGenres(names)`** — lowercase the title's genres and escalate `EVERYONE → MATURE → ADULT` against adult/mature name lists (or an on-page 18+ badge). Reuse the same function for both the details boundary and discover/search items so badges match; items whose listing carries no genres default to `EVERYONE` (comment why) or the source's global adult toggle.
- **Floor per-title ratings only against a genuine per-title floor** — a theme base's `defaultContentRating` field that means "every title here is at least this" (`defaultContentRating === ADULT ? ADULT : derive(...)`). The pbconfig source-level `contentRating` is different: it is a source-wide presence flag ("this source contains some adult content"), NOT a per-title floor, so a title can still resolve to `EVERYONE` on a source whose pbconfig rating is `ADULT` — do not clamp per-title ratings up to it.
- **Prefer `Application.getDefaultUserAgent()`** over a hardcoded UA unless the site requires a pinned one — document why if so.
- There is no `id`/`author`/`websiteBaseURL` in 0.9 pbconfig — the dir name is the id; the base URL lives in code.
- Forms: `SelectRow` uses `items` + `layout` (not deprecated `options`); `maxItemCount` reflects real selection semantics (`1` for single-select), not the option count. No `FormState` class pattern. Use current `ExtensionImpl` and non-deprecated `SourceIntents` only; use Paperback types directly (no re-export/re-wrap); use the `URL` class for dynamic path building.
- **Wire every form-row callback with `Application.Selector(this as <ConcreteForm>, "handleX")`** (or a `closureSelector(this, "id", async (v) => …)` for inline handlers — one style per form). The `this as <ConcreteForm>` self-cast is required, and the named handler must be a real `async` method on that class. Tri-state genre filters use `TriStateSelectRow` (`allowExclusion`/`allowEmptySelection`, value `Record<string, "included" | "excluded">`).
- **AdvancedSearchForm skeleton:** one private field per metadata key seeded from `searchQuery.metadata ?? {}` in the constructor, one `handleXChange` per field, and a sparse `getSearchQueryMetadata()`. Prefer the native `AdvancedSearchForm` over the `@paperback/types/lib/compat/0.8` `SearchFilterForm` shim (a temporary migration wrapper).
- **Sorting:** keep the site's sort token as `value` on an `as const` `SORT_OPTIONS`; `getSortingOptions` exposes only `{ id, label }`; translate id→token with a small mapper at the call site. If `SORT_OPTIONS` has exactly one consumer, declare it as `{ id, label }` in `models.ts` and return it directly instead (see the single-consumer rule in [§2](#2-file-organization)).
- **Group settings into correctly-named sections** — combine related rows under one section named for what it controls (e.g. language + browse filters → "Browse Settings"; title-view options → "View Settings"), rather than scattering one-row sections. [review]
- Verify every title, label, footer, and toggle description against the request behavior it controls. Misleading UI copy is a functional bug, not a wording nit.
- **pbconfig specifics** (per the Inkdex dev guide): `name` avoids spaces and matches the directory (`anilist.co → AniList`, never the raw domain); the const in `main.ts` (`export const <Name> = new <Name>Extension()`) must equal the directory name; `description` reads `Extension that pulls content from <domain>.`; `language` is a lowercase ISO 639-1 code, `multi` for multi-language; a developer entry needs only `name` (`website` and `github` optional — if both are given only `website` shows).

---

## 8. Theme Placement

- A site matching a recognized generic theme (MangaStream/MangaReader, Madara, etc.) belongs in **that theme's inkdex repo, extending the shared generic base**. A bespoke reimplementation in general-extensions is a rejection. [policy]
- Only genuinely unique/custom sites are bespoke here.
- **Repo-specific note:** `KingOfShojo` (MangaStream) and `RokariComics` (MangaStream; currently vendors a `generic/` base) are flagged against this rule and are **pending a placement decision by the maintainer**. Do not treat their current in-repo bespoke/vendored form as an endorsed pattern.

### How a theme base is built (config-driven generic base)

The `inkdex/<theme>-extensions` repos (madara, mangastream, liliana, mangabox, mangaworld, …) hold a shared `src/generic/` base plus thin per-site sources. When authoring or reviewing one:

- `generic/` carries the usual layers (`main.ts`/`network.ts`/`parsers.ts`/`models.ts`/`forms.ts`(+dir)/`config.ts`). `config.ts` exports a default `basePbConfig satisfies ExtensionInfo` (empty `name`/`description`, shared `capabilities`/`developers`, a `BASE_VERSION` constant) and a `customVersion({ increasePrerelease, ... })` helper. The base class is `abstract` and `implements ExtensionImpl<typeof basePbConfig>`.
- Version inverts the per-source rule: bump `BASE_VERSION` once in the base; each site's `pbconfig.ts` spreads `basePbConfig`, overrides `name`, and sets `version: customVersion(...)`.
- A per-site source is a thin subclass. Two override styles exist — **params-object DI** (constructor takes one `GenericParams` object; every knob defaults via `params.x ?? default`, and collaborators default to fresh instances: `params.parser ?? new Parser()`, `params.requestManager ?? new Interceptor(...)`) and **abstract-field** (base declares `abstract domain`/`contentRating` plus reassignable public selector fields the parser reads off `source`). This DI is the second sanctioned class-based exception (see [§2](#2-file-organization)).
- These bases are WIP; several currently violate the guide (deprecated `saveCloudflareBypassCookies`, flag-emoji langCodes, `Cheerio<any>`, inline section literals, 0.8 compat form shim). Follow the guide, not the base's current code, and don't copy those patterns into a new source.

---

## 9. Commit & Verification

### License headers

Every extension implementation file starts with (generated `src/tests/*` are exempt):

```ts
/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
```

### Commits

- Conventional Commits, **scope = the source name**. Commit type = highest semver impact: `feat`/`refactor` > `fix` > `chore`. Branch names follow Conventional Branch 1.0.0; versions follow Semantic Versioning 2.0.0.
- AI-assisted commits include an `Assisted-by: AGENT_NAME:MODEL_VERSION` trailer. [policy]
- Toolchain: Node.js **24** (matching this repository's workflows) + `npm install` after cloning; the repo's `.oxfmtrc.json`/`.oxlintrc.json` govern format/lint — use them, not your IDE's own formatter (a churned import sort is an instant review flag).

### Verification gate (run before declaring work done / opening a PR)

- **`npm run conformance` must pass** — `tsc` + `oxlint --type-aware --deny-warnings` + `oxfmt`. This is also the pre-push hook. Type-only imports use `import type`; leave imports in oxfmt's sorted order. No `new Array(n)` (use `Array.from({ length: n })`).
- **Format with `oxfmt` (`npm run format`), never Prettier.** Prettier's output differs from `oxfmt` (import sorting, wrapping) and fails `format:check`; don't reach for it even when it's the muscle-memory default.
- **`npm test` must pass, and `src/tests/<Name>.ts` contains nothing but `registerDefaultTests`.** Generate the baseline with `npx paperback-cli test --generate <Name>` and ship it as generated — **no custom `suite.test(...)` cases in a source PR**, no bespoke fixtures, no assertions about ids, section shapes, or parser internals. **The call takes exactly three arguments; there is no fourth options object** — not capability opt-outs (`{ chapterProviding: false }`, removed from AllManga once chapters worked) and not seeded inputs (`{ searchResultsProviding: { getSearchResults: [{ title: "love" }, …] }, mangaProviding: { getMangaDetails: ["/read-manga/…/"] } }`, removed from Mangago). Seeding the defaults with a hand-picked title or id makes the suite pass on that one record instead of on the source. Every one of the merged sources on `0.9/stable` follows this: each `src/tests/*.ts` is 12–18 lines and its only call is `registerDefaultTests(suite, <Source>, sourceInfo)`. The file should read:

  ```ts
  export async function runTests(logger: TestLogger) {
    const suite = new TestSuite("<Name> tests", logger);
    registerDefaultTests(suite, <Name>, sourceInfo);
    await suite.run();
  }
  ```

  Default tests cover `initialise → getSortingOptions → getSearchResults → getMangaDetails → getChapters → getChapterDetails`; verify Discover sections and settings forms by hand in-app, not with extra test cases. [review]

- **Test on a device with `npm run dev`** (phone + computer on the same network → add the printed `http://<lan-ip>:8080/` as a repo; hit reload to reinstall, no version bump needed). Note Paperback will "update" between any two same-name extensions whose version strings merely differ — even downgrades — so be deliberate with the published `alpha.N`.
- New source (or removal / branding / domain change) → update the root README "Sources" list. Maintainers block on a missing entry.
- Don't edit the PR template; explain any test failure under the summary block instead. A green PR still needs ≥1 maintainer approval.

### Source review checklist

- Confirm the diff is a direct base-to-head tree diff; account for a diverged merge base. Separate real source changes from version bumps, lockfile/formatter churn, generated bundles, and other-source edits.
- Confirm every Discover section returns the intended titles, card type, metadata, ordering, and next page; check that listings do no per-item detail requests.
- Test empty search, ordinary text search, pasted source URLs, sorting, included genres, excluded genres.
- Test public unlocked chapters, optionally-shown locked chapters, non-public chapters, and empty/locked reader responses.
- Confirm IDs are encoded/decoded exactly once and remain sufficient for later requests.
- Search user-facing strings for decorative emoji/icons and replace them with plain functional text; allow SDK symbol fields only when paired with text.
- Verify the required version bump and SPDX headers.

---

## 10. Project-Specific Deviations

Deliberate, owner-approved departures from the rules above. Do not replicate these into new sources without the same justification.

- **KingOfShojo — per-card detail fetch in `buildFeaturedItems`.** The [no per-item detail fan-out](#no-per-item-detail-fan-out) rule is intentionally violated here: the site's "Popular Today" listing payload carries **no adult signal**, and per-item adult filtering is required, so each featured card is fetched for its details. This is a deliberate, owner-approved deviation — not a template for other carousels. [review]
- **KingOfShojo & RokariComics — theme placement pending.** Both are MangaStream-themed and would normally live in the MangaStream theme repo extending its generic base (RokariComics additionally vendors a local `generic/`). They remain here pending a maintainer placement decision (see [Theme Placement](#8-theme-placement)). Treat their presence as provisional.
