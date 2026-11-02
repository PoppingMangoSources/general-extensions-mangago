# Paperback 0.9 SDK and app

Checked against the installed `node_modules/@paperback/types` and `@paperback/toolchain`
(1.0.0-alpha.92, the newest published; `latest` still points at alpha.64, so install with the
pinned `^1.0.0-alpha.92`). The types are alpha: read the `.d.ts` before relying on a line here.
Official sources: `Paperback-iOS/paperback-toolchain` branch `0.9` and its `.changeset/`; the
inkdex fork `inkdex/paperback-toolchain` branch `0.9`.

## Shapes

- `SourceManga` is `{ mangaId, mangaInfo }`. `MangaInfo` has `thumbnailUrl`, `synopsis`,
  `primaryTitle`, `secondaryTitles`, `contentRating`, `contentType?: "comic" | "novel"`,
  `status`, `artist`, `author`, `bannerUrl`, `rating`, `tagGroups`, `artworkUrls`,
  `additionalInfo`, `shareUrl`. There is no language field: language is per chapter
  (`Chapter.langCode`).
- `Chapter`: `chapterId`, `sourceManga`, `langCode`, `chapNum`, `title?`, `version?`, `volume?`,
  `additionalInfo?`, `publishDate?`, `creationDate?`, `sortingIndex?`.
- `ChapterDetails` is one of `{ type?: "images", pages }`, `{ type: "html", html }` and
  `{ type: "file", format: "epub" | "pdf" | "cbz", request }`, each with `id` and `mangaId`.
- `DiscoverSectionItem.type`: `featuredCarouselItem`, `simpleCarouselItem`,
  `prominentCarouselItem`, `chapterUpdatesCarouselItem`, `genresCarouselItem`.
  `featuredCarouselItem.infoItems` is `[InfoItem] | [InfoItem, InfoItem]`; `.slice(0, 2)` widens
  to an array and fails to typecheck, so build the tuple.
- `EndOfPageResults` is the end-of-pagination constant.
- A `.map()` over a mapper returning `T | undefined` needs
  `.filter((item): item is T => item !== undefined)`; it is not dead code.

## `Application`

- `setState(value: unknown, key: string)`: value first. `getState(key)`.
- `scheduleRequest(request)` returns `[response, ArrayBuffer]`; `arrayBufferToUTF8String`.
- `base64Decode` may return a string or an `ArrayBuffer`.
- `decodeHTMLEntities`, `invalidateDiscoverSections`, `getDefaultUserAgent(): Promise<string>`.
- `Application.Selector(obj, "method")` for form callbacks; `closureSelector` for closures.
- Deprecated: `registerDiscoverSection` (return sections from `getDiscoverSections`).
- Not on the device: `TextDecoder`/`TextEncoder`, `fetch`, the DOM. `crypto.subtle` works
  (merged Mangago, AllManga); `new SubtleCrypto()` throws. Guard `setTimeout`. Code inside a
  WebView script string runs in the page, where browser globals exist.

## Runtime lessons from sources here

- The global `URL` polyfill mis-resolves `new URL(absolute, base)` and folds a mirror host back
  to the base. Use the SDK `URL` class with one argument and string-parse absolute URLs.
- A Cloudflare clearance is bound to the user agent that solved it (full Mobile Safari), while
  `getDefaultUserAgent()` returns a bare WebView one. Send one identity for both the
  `CloudflareError` and every request, or the challenge loops (Ranobes).
- Session-bound apps (Laravel `<site>_session`, `XSRF-TOKEN`) need every cookie forwarded after
  the bypass; DDoS-Guard names its cookies `__ddg*`, so a `cf` prefix filter drops them.
- A site behind several mirrors that fail independently keeps an ordered list and remembers
  the last host that worked; a `CloudflareError` is a challenge, not a dead mirror.
- Synthetic dates must be stable across refreshes: anchor them to the title's update time or a
  persisted first-seen time.
- Novel XHTML: wrap the body as
  `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>…</body></html>` and close
  void elements (`cheerio.load(html, null, false).html({ xml: true })` does it); Readium rejects
  unclosed `<br>`.

## Capabilities

`pbconfig.ts` `capabilities` drive which methods `ExtensionImpl<typeof Config>` requires:

| `SourceIntents`                | Required                                                           | Optional                                     |
| ------------------------------ | ------------------------------------------------------------------ | -------------------------------------------- |
| `CHAPTER_PROVIDING`            | `getChapters`, `getChapterDetails`                                 | `processTitlesForUpdates`                    |
| `DISCOVER_SECTION_PROVIDING`   | `getDiscoverSections`, `getDiscoverSectionItems`                   |                                              |
| `SEARCH_RESULT_PROVIDING`      | `getSearchResults`                                                 | `getSortingOptions`, `getAdvancedSearchForm` |
| `SETTINGS_FORM_PROVIDING`      | `getSettingsForm`                                                  |                                              |
| `CLOUDFLARE_BYPASS_PROVIDING`  |                                                                    | `cloudflareBypassCompleted`                  |
| `PROGRESS_PROVIDING`           | progress form, `getMangaProgress`, `processChapterReadActionQueue` |                                              |
| `MANAGED_COLLECTION_PROVIDING` | the three collection methods                                       |                                              |

Deprecated names, all rejected by the checker: `MANGA_CHAPTERS`, `MANGA_PROGRESS(_PROVIDING)`,
`DISCOVER_SECIONS(_PROVIDING)`, `COLLECTION_MANAGEMENT`, `CLOUDFLARE_BYPASS_REQUIRED`,
`SETTINGS_UI`, `MANGA_SEARCH`, `SEARCH_RESULTS_PROVIDING`. Also deprecated:
`saveCloudflareBypassCookies` (use `cloudflareBypassCompleted(request, cookies, localStorage)`),
`SelectRow` `options` (use `items` + `layout`), the `compat/0.8` search-form shim.

## Forms

- `SelectRow(id, { title, value, minItemCount, maxItemCount, items, layout: "flow" | "list" })`.
  Use `"list"` for long option lists.
- `TriStateSelectRow` value is `Record<string, "included" | "excluded">`, with
  `allowExclusion` and `allowEmptySelection`.

## Toolchain

- `paperback-cli bundle` writes `bundles/` (`versioning.json`, the homepage); `npm run bundle`
  then applies our theme (`scripts/theme-homepage.mjs`). Keep the official layout, page and
  `paperback://` links.
- `paperback-cli serve [--watch]` serves `bundles/` to a phone on the same network.
- `paperback-cli logcat` streams device logs (the app's Developer Tools replaced Pulse in r200).
- `paperback-cli test [Name] --generate` writes the baseline; without `--generate` it runs the
  default suite (`initialise`, sorting, search, details, chapters, chapter details) against the
  live site. It exits 0 on failure: read the report with `scripts/check-tests.mjs`.

## App changes that matter to sources

From the developer's beta notes (newer than the repository):

- r207: the reader can mark a title as a webtoon, but alpha.92 has no field for it. Do not
  invent one; wait for the types.
- r207: reader layout and chapter sorting moved into per-extension and per-title settings, so a
  source does not need its own setting for them.
- r200: the app no longer loads every extension at start-up; quick search runs lazily per
  source. Keep `initialise` cheap.
- r200: data: links no longer crash the app; better JS error reporting means thrown messages
  reach the user, so make them useful.
- r199: GIF support; an option to downscale thumbnails.
- r190: the novel reader tracks progress; search-as-you-type debounces 800 ms.
