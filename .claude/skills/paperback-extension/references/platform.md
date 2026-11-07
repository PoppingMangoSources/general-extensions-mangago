# The 0.9 platform

What the toolchain, the test runner and the app actually do, read line by line from
`Paperback-iOS/paperback-toolchain` branch `0.9` (packages `types`, `toolchain`,
`runtime-polyfills`, all `1.0.0-alpha.94`, published under the `alpha` tag; npm `latest` still
points at alpha.64, so install with `^1.0.0-alpha.94`) and from device findings. alpha.93 reworked
the managed-collection API, added `MangaInfo.isWebtoon` and fixed `=` inside URL query values and
test-VM cookie values; alpha.94 only updated dependencies. Tags: **[src]** read in the toolchain source, **[device]**
probed on a phone (kodama's notes unless named), **[merged]** used by a merged inkdex source.
Re-check a line against `node_modules/@paperback/*` before building on it.

**The one rule:** `npm test` runs the bundle in a Node `vm`; the shipped source runs in
JavaScriptCore behind a Swift bridge. Anything only the bridge validates passes every test.

## Toolchain commands [src]

| Command                                                                           | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paperback-cli bundle [--folder f] [--debug] [--tests]`                           | Every `src/<dir>` holding both `pbconfig.ts` and `main.ts` becomes `bundles/<f>/<dir>/index.js` (rolldown, one minified IIFE named `source`, target es2020, every import inlined), plus `info.json` (the pbconfig default export with `id = <dir>`) and a copy of `static/`. Then `versioning.json` (`buildTime`, `builtWith.{toolchain,types}`, `repository.{name,description}` from `package.json`, `sources`) and `index.html`. `--debug` keeps it unminified with inline sourcemaps. |
| `paperback-cli serve [--port] [--watch]`                                          | Bundles (no folder, no tests, minified) and serves `./bundles` over HTTP with CORS, printing LAN addresses; `--watch` rebuilds 500 ms after a change in `src`. It does not run our homepage theme.                                                                                                                                                                                                                                                                                       |
| `paperback-cli test [Name] [--generate] [--overwrite] [--output f] [--noConsole]` | Bundles `src/tests/<Name>.ts`, runs it in a VM, writes the report. Takes at most one name ("Too many arguments" otherwise, alpha.94): loop for several. Exits 0 even when tests fail, and silently skips a source with no test file: read the report with `scripts/check-tests.mjs`.                                                                                                                                                                                                     |
| `paperback-cli logcat --ip <phone> [--port 27015]`                                | Streams the app's logs over gRPC (`PaperbackLogger.streamLogs`).                                                                                                                                                                                                                                                                                                                                                                                                                         |

`engines.node` is `>=24`. A `PDTSourceTester` gRPC service (install and test a source on the
device) is defined but no command uses it yet. The homepage's capability badges never render
(its label keys do not match its intent keys): an upstream template bug, not ours.

The homepage builds `paperback://addRepo?displayName=<package.json name>&url=<page base URL>` and
`paperback://installExtensions?data=<base64 JSON [[id, baseUrl], …]>`, so the repository name and
the published folder (`/0.9/test/`) are part of every install link.

## The test VM versus the device

|                                    | `npm test` (Node VM) [src]                                                                                                                                                                                                                 | Device                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Globals                            | ES2020+ JSC set including `Float16Array`, `Iterator`, `WeakRef`, `Intl`; plus Node's `Buffer`, `TextEncoder`, `TextDecoder`, `EventTarget`, `Event`, `crypto`, `SubtleCrypto` (commented "extra polyfills provided by the app")            | No `setTimeout`/`setInterval` [device]; WebCrypto present [device, 2026-08-15]. Treat `Buffer`/`TextDecoder` as unverified: prefer `Application.arrayBufferToUTF8String` (the merged convention)                                                                                                                                |
| `crypto.subtle`                    | Node's complete WebCrypto                                                                                                                                                                                                                  | Swift bridge [src `types/polyfills/Crypto.ts`]: `digest`; `generateKey`/`importKey` (raw, jwk)/`exportKey`; `encrypt`/`decrypt` **AES-GCM and AES-CBC only**; `sign`/`verify` HMAC; `deriveBits`/`deriveKey` HKDF, PBKDF2. No AES-CTR, AES-KW, RSA or EC; `wrapKey` rejects. `getRandomValues` up to 65,536 bytes; `randomUUID` |
| Timers                             | absent from the VM too                                                                                                                                                                                                                     | `Application.sleep(seconds)` (seconds, not ms)                                                                                                                                                                                                                                                                                  |
| `Application`                      | `runtime-polyfills`: state in memory; `executeInWebView` throws "Not Implemented"; `filterAdultTitles`/`filterMatureTitles`/`isResourceLimited` false; user agent a random mobile one; `decodeHTMLEntities` is `entities.decodeHTMLStrict` | the real app                                                                                                                                                                                                                                                                                                                    |
| Request interceptors               | **bug**: each receives the original request (`finalRequest = await interceptor(request)`), so only the last registered one's changes survive                                                                                               | chained                                                                                                                                                                                                                                                                                                                         |
| Response interceptors              | chained, reverse registration order                                                                                                                                                                                                        | chained, reverse order                                                                                                                                                                                                                                                                                                          |
| Redirects                          | Node `fetch` follows them; `setRedirectHandler` is a no-op                                                                                                                                                                                 | interceptors run on the first request only, so re-apply headers in `setRedirectHandler` [merged: Mangago]; kodama reports 3xx returned unfollowed: handle both                                                                                                                                                                  |
| Object request body                | sent as `FormData`                                                                                                                                                                                                                         | encoded by Swift; numeric `0` becomes `false` [device]. Send `JSON.stringify(body)`                                                                                                                                                                                                                                             |
| `Metadata` with an `undefined` key | fine                                                                                                                                                                                                                                       | crash: "Expected value of type `JSValue`, found `nil`" [device]. Omit keys                                                                                                                                                                                                                                                      |
| Id fields                          | unchecked                                                                                                                                                                                                                                  | every id-typed field (manga, chapter, `Tag.id`, `DiscoverSection.id`, form rows) must match `[a-zA-Z0-9._\-@()[\]%?#+=/&:]`; "Invalid ID `Slice of Life`" crashed a series page [device]                                                                                                                                        |
| Images                             | the default suite never fetches them                                                                                                                                                                                                       | the app's cover and page requests go through your interceptors [device]                                                                                                                                                                                                                                                         |

Since alpha.92 the VM also injects Node's `Promise`, which breaks the 0.8-compat
`SearchFilterForm` (`instanceof Promise`): "this.filters.map is not a function" (pirate.vodka).
Native `AdvancedSearchForm` sources are unaffected.

## What the default suite proves [src `suite.template.ts`]

`registerDefaultTests(suite, source, info)`: `initialise`; `getSortingOptions` (if present) not
empty; `getSearchResults({ title: "" }, undefined, firstSort)` has items; `getMangaDetails` on the
first result (always, whatever the capabilities); `getChapters` not empty; `getChapterDetails` on
`chapters[0]` returns something. So: **an empty search must return results**, the newest chapter
must open (a locked first chapter fails the test), and page lists, Discover, settings, forms and
images are never checked. `--generate` writes `suite.ts` (if missing) and `<Name>.ts` without the
license header; the repository formatter rewrites it.

## `Application` [src `types/src/impl/Application.ts`]

- `isResourceLimited`: skip optional work in `initialise` when true [merged: Mangapill,
  WeebCentral]. `filterAdultTitles`, `filterMatureTitles`: the reader's content filters.
- `decodeHTMLEntities`, `sleep(seconds)`.
- `getDiscoverSections` is the way to declare sections; `registerDiscoverSection` is deprecated.
  `invalidateDiscoverSections()` after any setting that changes them.
- `registerInterceptor`/`unregisterInterceptor`; `setRedirectHandler(selector)` receives
  `(proposedRequest, redirectedResponse)` and returns a request or `undefined` to stop.
- `getDefaultUserAgent(): Promise<string>`; `scheduleRequest(request): Promise<[Response, ArrayBuffer]>`.
- `arrayBufferToUTF8String`, `arrayBufferToASCIIString`, `arrayBufferToUTF16String`.
- `base64Encode`/`base64Decode` return a string when the result is valid UTF-8, else an
  `ArrayBuffer`: handle both.
- `crypto_md5Hash(string | ArrayBuffer): string` (hex) [merged: MangaTaro, Roliascan].
- `getState`/`setState(value, key)` (value first); `getSecureState`/`setSecureState` for tokens
  [merged: MangaDex], not cleared by `resetAllState()`. Clear a value with `undefined`, not `""`
  (celarye on #196); stored `0` reads back as `false` [device].
- `executeInWebView({ source: { html, baseUrl, loadCSS, loadImages, userAgent? }, inject,
  storage: { cookies }, captureConsoleLog? })` returns `{ result, storage: { cookies } }`. Its
  requests bypass your interceptors and limiter: call the limiter yourself and pass
  `cookieInterceptor.cookiesForUrl(url)` [merged: MangaFire]. Untestable locally.
- `Application.Selector(obj, "method")` registers a `WeakRef`: the object must stay referenced (a
  class field), or the callback resolves to `undefined` [src runtime-polyfills]. The
  `this as ConcreteForm` cast is required by the types.

## SDK classes [src]

- `PaperbackInterceptor(id)`: `interceptRequest`, `interceptResponse(request, response, data)`;
  call `registerInterceptor()` in `initialise`.
- `BasicRateLimiter(id, { numberOfRequests, bufferInterval, ignoreImages })`: `bufferInterval` is
  **seconds**; `ignoreImages` only skips URLs ending in `.avif|gif|jpeg|jpg|jxl|png|webp` (an
  extensionless image URL counts against the limit); it sleeps with `Application.sleep`.
- `CookieStorageInterceptor({ storage: "stateManager" | "memory" })`: id `cookie_store`, state
  key `cookie_store_cookies`. It stores every response `Set-Cookie` itself; **only cookies with an
  `expires` survive a restart**; matching strips a leading `www.`/`.` from the cookie domain and
  prefers the longest path. `setCookie`, `deleteCookie`, `cookiesForUrl`. Before alpha.93 the
  test VM cut a `Set-Cookie` value at its second `=` (base64 padding) and, because of the space
  after each `;`, never read `Expires`, `Max-Age` or `Domain`: every cookie got `expires` = now and
  the response host as its domain. A cookie session that failed only in `npm test` on alpha.92
  should be retested.
- `CloudflareError(resolutionRequest, message?)` shows the bypass banner only when the source
  declares `CLOUDFLARE_BYPASS_PROVIDING`.
- `URL(string)`: one argument; protocol and host required (a relative URL throws).
  `addPathComponent` does not encode; `setQueryItem(key, string[])` repeats the key; values are
  encoded on `toString()`; an empty `queryItems` leaves a trailing `?`; parsing splits each pair on
  its first `=` only (alpha.93; earlier versions dropped the rest of the value) and does not
  decode `+`.
- `Lock`: `lock(id)`/`unlock(id)` helpers.

## Interfaces [src]

- `getChapters(sourceManga, sinceDate?)` returns the complete list; `sinceDate` lets a source stop
  early on incremental updates.
- `processTitlesForUpdates(updateManager, lastUpdateDate?)`: implement **only** when the site
  can tell in bulk which titles changed. `UpdateManager`: `getQueuedItems`,
  `setUpdatePriority(id, "high" | "low" | "skip")`, `getNumberOfChapters`, `getChapters`
  (expensive), `setNewChapters` (skips `getChapters`; `sortingIndex` must then be right). Throw
  `CloudflareError` there when a challenge is pending.
- `processChapterReadActionQueue` (trackers) must never throw; put every action in
  `successfulItems` or `failedItems`.
- `AdvancedSearchForm`: `requiresExplicitSubmission` is always true; errors in
  `getSearchQueryMetadata` reset the metadata.
- `Form`: `getSections`, `reloadForm()`, `formWillAppear`/`formDidAppear`/`formWillDisappear`/
  `formDidDisappear`, `formDidSubmit` (throw to keep the form open with an alert),
  `formDidCancel`. Populate rows from the network in `formDidAppear`, then `reloadForm()`.
- Rows: `LabelRow` (`style`: warning, error, success, tinted; `onSelect`), `InputRow`
  (`isSecureEntry`), `StepperRow`, `ToggleRow`, `SelectRow` (`items` + `layout`; `options`
  deprecated), `TriStateSelectRow` (`maximum`), `ButtonRow`, `WebViewRow` (sign-in, returns
  cookies), `NavigationRow`, `OAuthButtonRow` (token, code, PKCE), `DeferredItem`. Sections:
  `Section`, `FlowSection`, `EditSection` (add, delete, reorder), `SelectSection`,
  `TriStateSelectSection`. `FormConfirmationError(onConfirmation, message)` asks before an action.

## Types [src]

- `MangaInfo`: `thumbnailUrl`, `synopsis`, `primaryTitle`, `secondaryTitles`, `contentRating`,
  `contentType?: "comic" | "novel"`, `isWebtoon?` (alpha.93: true makes the reader scroll
  vertically with no page padding unless the reader set those on the title; default false),
  `status`, `artist`, `author`, `bannerUrl`, `rating`
  (rendered as a percentage of 0..1: a ten-point 9.22 showed as 922% [device]), `tagGroups`,
  `artworkUrls`, `additionalInfo`, `shareUrl`. No language: that is `Chapter.langCode` (an IETF
  code, never a flag; niclim on #246).
- `Chapter`: `chapterId`, `sourceManga`, `langCode`, `chapNum`, `title?`, `version?`, `volume?`,
  `additionalInfo?`, `publishDate?`, `creationDate?`, `sortingIndex?`. On the device: an unset
  `volume` shows "Vol. TBA" (use 0 when the site has none); a row reads
  "Chapter {chapNum} - {title}", so strip a leading number from `title`; chapters sharing a
  `chapNum` are versions of one chapter, labelled by `version`; in one test `sortingIndex` did not
  override the visible order, so keep `chapNum` monotonic [device].
- `ChapterDetails`: `{ type?: "images", pages }`, `{ type: "html", html }` or
  `{ type: "file", format: "epub" | "pdf" | "cbz", request }`, each with `id` and `mangaId`.
- Novel `html` is parsed as XML (libxml2) [device]: self-close void elements, strip undeclared
  namespace attributes (`epub:type`), only `&amp; &lt; &gt; &quot; &apos;` are named entities
  (`&nbsp;` is fatal: use `&#160;`), and wrap the body in
  `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>…</body></html>` or it renders
  as one line. `xmllint --noout` reproduces the parse locally.
- `DiscoverSection { id, title, subtitle?, type }`, `DiscoverSectionType` `featured`,
  `simpleCarousel`, `prominentCarousel`, `chapterUpdates`, `genres`. Items: `featuredCarouselItem`
  (`supertitle`, `summary`, `infoItems` a tuple of one or two), `simpleCarouselItem`,
  `prominentCarouselItem`, `chapterUpdatesCarouselItem` (`chapterId`, `publishDate`),
  `genresCarouselItem` (`name`, `searchQuery`); each takes `contentRating`. Build the exact
  variant; an `as DiscoverSectionItem` cast hides wrong fields.
- `PagedResults { items, metadata? }`: no `metadata` ends paging; `EndOfPageResults` is the
  frozen empty end.
- `SearchResultItem { mangaId, title, subtitle?, imageUrl, metadata?, contentRating? }`.
- `SourceManga` counts are read-only. `Tag { id, title }`, `TagSection { id, title, tags }`.
- `ContentRating`: `EVERYONE` (`"SAFE"`), `MATURE`, `ADULT`.
- `PBCanvas`/`PBImage` are typed, but the 0.9 `Application` declares no way to create them
  (only the 0.8 compat types do). Verify on a device before relying on them.
- `SourceIntents` aliases `MANGA_CHAPTERS`, `MANGA_PROGRESS(_PROVIDING)`, `DISCOVER_SECIONS(_PROVIDING)`,
  `COLLECTION_MANAGEMENT`, `CLOUDFLARE_BYPASS_REQUIRED`, `SETTINGS_UI`, `MANGA_SEARCH`,
  `SEARCH_RESULTS_PROVIDING` are deprecated; `saveCloudflareBypassCookies` too.

## Capabilities [src]

| `SourceIntents`                | Required                                                                                                    | Optional                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| always                         | `initialise`, `getMangaDetails`                                                                             |                                                             |
| `CHAPTER_PROVIDING`            | `getChapters`, `getChapterDetails`                                                                          | `processTitlesForUpdates`                                   |
| `DISCOVER_SECTION_PROVIDING`   | `getDiscoverSections`, `getDiscoverSectionItems`                                                            |                                                             |
| `SEARCH_RESULT_PROVIDING`      | `getSearchResults`                                                                                          | `getSortingOptions`, `getAdvancedSearchForm`                |
| `SETTINGS_FORM_PROVIDING`      | `getSettingsForm`                                                                                           |                                                             |
| `CLOUDFLARE_BYPASS_PROVIDING`  |                                                                                                             | `cloudflareBypassCompleted(request, cookies, localStorage)` |
| `PROGRESS_PROVIDING`           | `getMangaProgressManagementForm`, `getMangaProgress`, `processChapterReadActionQueue`                       |                                                             |
| `MANAGED_COLLECTION_PROVIDING` | `getManagedCollections`, `getManagedCollectionItems(collections)`, `applyManagedCollectionChanges(changes)` |                                                             |

Managed collections (alpha.93): `getManagedCollectionItems` returns every requested collection's
`{ collectionId, items }` in one call, so a tracker fetches its library once.
`applyManagedCollectionChanges` receives `add`, `remove` and `move` changes, each with an `id`;
return `{ changeId, reason }` for the ones that failed and throw only when none applied.
`ManagedCollection.exclusiveGroup` marks collections a title can be in only one of: an `add` or
`move` into one takes it out of the others. `getManagedLibraryCollections`,
`commitManagedCollectionChanges`, `getSourceMangaInManagedCollection`, `PartialLibraryItem`,
`LibraryItemSourceLinkProposal` and `ManagedCollectionChangeset` are gone **[check]**.
`0.9/test` runs alpha.94; `0.9/stable` stays on alpha.92 because inkdex's MangaDex
(`implementations/managed-collection/`) still implements the old three methods and fails `tsc`
on alpha.93+. Move stable once inkdex migrates MangaDex; never patch their source on our stable.

`capabilities` is an array (niclim on #230). The app's sort control has no direction toggle, so a
site with field and direction lists each combination as one option.

## Sites with an OpenAPI spec

Paperback's own `extensions-default` (Komga) generates a typed client with
`@hey-api/openapi-ts` and a plugin whose client calls `Application.scheduleRequest`. For one site
with a large published spec that is the official pattern; for an ordinary site a few fetch
helpers are what inkdex merges.

## App changes from the developer's beta notes

- r207: the reader can mark a title as a webtoon; alpha.93 added `MangaInfo.isWebtoon` for it.
  Set it from the site's own type or format field (Manhwa, Manhua, Webtoon, Long Strip), never
  from a title, genre tag or language, and leave it unset when the site says nothing. Reader layout and chapter sorting moved into Chapter Settings (all titles, per extension,
  per title), so a source needs no setting for them.
- r200: extensions load lazily and quick search runs per source on scroll: keep `initialise`
  cheap. Better JS error reporting: thrown messages reach the user, so make them useful. Developer
  Tools replaced Pulse.
- r199: GIF support (do not skip GIF pages); thumbnail downscaling.
- r190: novel progress tracking; search-as-you-type debounced to 800 ms.
