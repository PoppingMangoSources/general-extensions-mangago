# Contributor & Reviewer Guide

The authoritative standards for authoring, refactoring, and reviewing Paperback **0.9 SDK** extensions in this repository. Every source here targets a site with a unique, non-generic theme. Extensions must be lean, maintainable, and consistent with the conventions below — these encode both the written guidelines and the conventions maintainers enforce in review.

Target: Paperback 0.9 / `@paperback/types` v1.0.0-alpha (the `ExtensionImpl` API), on the `0.9/*` branches. NOT the old 0.8 `Source`/`APIWrapper` style. `@paperback/types` is alpha and shifts — verify exact signatures against the installed version and the target repo's `tsconfig.json` rather than assuming.

Rules carry an attribution where a maintainer specifically owns them: **(niclimcy)** = code-review preference, **(celarye)** = standardization/tooling, **(both)** = jointly enforced, **[policy]** = enforced by CONTRIBUTING/PR template/CI and blocks merge.

---

## 1. Purpose & first principles

- **Pick the right repo before coding.** A site matching a recognized generic theme (MangaStream/MangaReader, Madara, etc.) belongs in that theme's inkdex repo, extending the shared generic base. A bespoke reimplementation of a themed site in general-extensions is a rejection. Only genuinely unique sites are bespoke here. See [Theme Placement](#8-theme-placement).
- **Verify the live contract first.** Inspect the real page/API response and confirm endpoints, query params, pagination fields, lock flags, delimiters, and error behavior before implementing or reviewing. Don't rely on copied reference implementations.
- **Follow a merged neighbor.** When a pattern is ambiguous, match a recently merged comparable source's file split, naming, and idioms rather than inventing your own. The stock `ContentTemplate` is an API demonstration, not a style model — it carries inline parsing, boilerplate comments, deprecated form props, and `"EN"` langCodes that these rules tell you to avoid.
- **Review behavior and request cost, not just shape.** Count network requests; verify pagination, filtering, lock visibility, URL-paste search, content ratings, and error/fallback behavior.

---

## 2. File Organization

### Canonical per-extension layout (flat — most sources)

| File                   | Holds                                                                            | Hard rule                                                   |
| ---------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `main.ts`              | the extension class **only**, plus `export const <Name> = new <Name>Extension()` | nothing else lives here                                     |
| `pbconfig.ts`          | metadata, default-exported `satisfies ExtensionInfo`                             | `name` = site branding, exactly                             |
| `static/icon.png`      | source icon                                                                      | square PNG, taken from the site                             |
| `models.ts`            | types, constants, data structures, search-metadata types, option arrays          | data only; `DOMAIN`/`API_URL` defined **once** here         |
| `network.ts`           | `PaperbackInterceptor` subclass(es) + rate limiter (fetch + interceptor)         | interceptor class name unique per source                    |
| `parsers.ts`           | all parsing (Cheerio / JSON) **and** every `toX` mapper/formatter                | standalone functions or a parser class — match the neighbor |
| `forms.ts` or `forms/` | `Form`/`AdvancedSearchForm` subclasses **and** settings-store accessors          | see accessor rule below                                     |
| `utils.ts` or `utils/` | heavy machinery **only**                                                         | see Utils Scope                                             |

- **main.ts holds ONLY the extension class.** All `toX` mappers and formatters live in `parsers.ts`, not `main.ts`. Standalone constants, types, and functions move out to their layer. Helper _methods_ on the class are fine. (niclimcy) [policy]
- **File-layer boundaries are hard** (niclimcy):
  - `models.ts` = types / constants / data structures only.
  - `network.ts` = fetch + interceptor.
  - `parsers.ts` = parsing and mappers.
  - `forms.ts` / `forms/` = `Form` subclasses **and** the settings-store accessors — the `getX`/`setX` helpers for base-url, domain, and preferences. **Settings accessors go in forms, NOT in models.**
  - `utils/` = heavy machinery only.
- **No new top-level filenames outside the canonical set.** Canonical files may become directories (`forms/search.ts`, `forms/settings.ts`, `utils/crypto.ts`) once sub-files improve clarity, but do not introduce a new top-level name. (niclimcy)
- **Utils scope.** `utils/` is strictly for substantial, isolated machinery: descramblers, decryptors, cipher/crypto, webview logic. An ordinary API fetch does **not** earn a util module. Thin filter, formatting, picker, or settings-store helpers must fold into their proper layer or call site — never a `utils/` module.

### Capability-sharded layout (large sources only)

Very large sources use `implementations/<capability>/` (kebab-case, e.g. `chapter-providing/`, `discover-section/`, `search-results/`, `settings-form/`, `manga/`, `shared/`), each with its own `main.ts`/`models.ts`/`parsers.ts` (+ `forms.ts`/`utils.ts` where relevant), plus a top-level `main.ts`, `pbconfig.ts`, `static/icon.png`, and the interceptor in `services/network.ts`. Follow a neighboring sharded source; the subdir names track capabilities but aren't a mechanical 1:1 of pbconfig intents.

These sources **compose capabilities by mixin, not inheritance**: each capability is a `XProvider` class (`SearchProvider`, `MangaProvider`, `ChapterProvider`, `DiscoverProvider`), the top-level class `implements Omit<Extension, keyof MangaProviding>` with a declaration-merged interface, and `applyMixins(XExtension, [...providers])` (a small prototype-copy helper in `implementations/shared/`) glues them. Reuse one provider from another by instantiating it (`new SearchProvider().getSearchResults(...)`), not by subclassing. This mixin form and the config-driven theme base ([§8](#8-theme-placement)) are the only sanctioned exceptions to "classes only when the framework requires them."

### Function-based design

- Parsers and API logic are free exported arrow functions (`parseX`, `buildX`, `toX`); file-local helpers are `const` arrow functions.
- **Classes only when the framework requires them:** the `PaperbackInterceptor` subclass and the `ExtensionImpl` subclass. No "Api" class for plain REST/Next.js GETs — use plain fetch helpers (`fetchNextData<T>`) + URL builders. No base classes to share small utility methods; use free functions taking instance args (`saveSetting(form, key, value)`).
- **A typed fetch helper takes a fully-built URL string, not a `Request`.** One `fetchApi<T>(url)` does the GET, status check, and JSON parse; callers pass a URL assembled by small `URL`-class builders (`novelsUrl(...segments)`, `novelsFeedUrl(segment, limit?)`) rather than interpolating path/query strings by hand. Wrap only the JSON parse in `try/catch` and surface the failing URL. (Matches MangaFire's `fetchApi`. Several older sources instead pass a `Request` object — the URL-string form is the target.)
- **Bind the class to its config: `implements ExtensionImpl<typeof XConfig>`**, with `import type XConfig from "./pbconfig"`. This is the standard `ExtensionImpl` form; the class type-checks against its own pbconfig capabilities.
- **HTML sources get the same fetch helper, one layer down.** The HTML analog of the JSON `fetchApi<T>` destructures `Application.scheduleRequest({ url, method: "GET" })` as `[response, buffer]`, checks `response.status`, decodes the buffer with `Application.arrayBufferToUTF8String(buffer)`, then returns the string or `cheerio.load(...)` (the docs' minimal `fetchText`/`fetchJSON<T>` discard the response as `[, buffer]`). Do not inline that `scheduleRequest → arrayBufferToUTF8String` dance at each call site.
- **Always route requests through `Application.scheduleRequest`**, never a raw fetch — it is what lets interceptors, the rate limiter, and dynamic cookies apply. Model a stable JSON response shape as a `<Thing>Response` interface in `models.ts` and fetch it as `fetchJSON<ThatType>(url)`.

### Simplification

- Delete dead/uncalled code aggressively (builders, constants, types, helpers). [policy]
- Inline single-use constants and trivial wrappers (a body that just renames, `?? default`, unwraps, or delegates one call). Collapse wrapper-of-wrapper helpers. Return new objects rather than mutating inputs.
- Prefer native array methods (`.map`/`.filter`/`.reduce`); `for...of` is also fine. Use `cheerio` for HTML — never hand-rolled parsing.

### Comments & naming

- Terse, non-obvious "why" comments only. **No boilerplate / "standard across all extensions" comments** — the top review tell. Document a shared pattern once at most, never per-file. No commented-out code (use a real `// TODO` or delete). No decorative dividers or empty docblocks.
- Clean, grammatical, typo-free names. Avoid names that read as a JS global (`data`, not `json`). PascalCase dirs/classes; ALL_CAPS option constants; kebab-case implementation subdirs.
- **Prefix unused interface-mandated params with `_`** (`_metadata`, `_response`, `_localStorage`) — or `void param;`, but keep one style per file, not both.
- Name parsed-JSON payload interfaces `<Thing>Response`/`<Thing>Dto`; anything passed as search/discover metadata must `extend JSONObject`.
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

- **`getDiscoverSectionItems` is a thin `section.id` switch** that delegates to focused handler methods. No inline fetch/parse/map in the dispatcher. (niclimcy) [policy]
- **`SECTIONS` is an `as const` object in `models.ts`.** No inline section-id string literals anywhere; reference `SECTIONS.POPULAR` etc. Prefer one grouped `as const` object over parallel `SECTION_*` constants. (both) The same applies to `Application` state keys — centralize them in an `as const` object and derive the union type (`type X = (typeof KEYS)[keyof typeof KEYS]`).
- **A `Record<sectionId, () => Promise<...>>` dispatch map is an accepted alternative to the switch** — either form is fine as long as the dispatcher itself does no inline fetch/parse/map.
- **Know the `DiscoverSectionItem.type` values:** `featuredCarouselItem`, `prominentCarouselItem`, `simpleCarouselItem`, `chapterUpdatesCarouselItem`, `genresCarouselItem`. A genres/tags section emits `genresCarouselItem`s whose embedded `searchQuery { title: "", metadata }` re-enters search rather than fetching. `featuredCarouselItem.infoItems` carry SF-Symbol `symbol` names (`star.fill`, `flame.fill`, `book.fill`, `eye.fill`).
- **Settings-toggled sections:** build `getDiscoverSections()` conditionally on `Application.getState("<section>_enabled") as boolean | undefined ?? true`, and call `Application.invalidateDiscoverSections()` whenever such a toggle changes.

### No per-item detail fan-out

- **Never fan out into one detail request per carousel/listing item** (`Promise.all(cards.map(getDetails))`). Build carousels/listings from the listing payload, which already carries the needed fields. An N+1 section stalls the whole carousel and amplifies rate-limit/Cloudflare failures. (niclimcy) See the documented exception in [Project-Specific Deviations](#10-project-specific-deviations).

### Search & pagination

- **Omit empty query params.** Never send placeholders like `searchTerm=""`, `s=""`, or `author=""`. Add an optional param only when it has a value. (niclimcy)
- **Use server-side filters when the API has them** — send both included and excluded genre IDs. Only crawl-and-filter client-side when the API genuinely lacks the filter. (niclimcy)
- **Send filter values in the site's exact casing and spelling.** Copy a real filtered request off the live site and mirror its parameter names and value case (e.g. lowercase `genres_exclude` values, not Title Case). A case/spelling mismatch is silently ignored by the server, so the filter appears wired up but does nothing.
- **Pagination derives from the API contract.** Read incoming page metadata, request the configured page size, and return next-page metadata from `totalCount`/the site's cursor. Don't hardcode page 1, cap with `.slice()`, or use an arbitrary smaller page size unless the UI contract requires it.
- **Don't clamp a curated feed to a fixed count.** A curated endpoint (e.g. editor's choice) should return exactly what the site lists; make the `limit` optional and append it only when one is genuinely needed, so entries the site later adds or removes track automatically instead of being frozen at a hardcoded number.
- **`hasMore` derives from the UNFILTERED server count/length.** When filtering locally, filter first, then slice/page from the filtered candidate set. (niclimcy)
- **Keep search metadata sparse** — `getSearchQueryMetadata` returns only non-empty fields; no empty arrays or empty genre maps.
- **URL-paste lookup is an optional fast path.** Match only supported source URLs, encode the slug once, and return `undefined` when it can't resolve so ordinary text search continues. Do not use blanket error suppression on normal API/parser/reader paths.
- **Use the SDK's pagination sentinels.** Return the `EndOfPageResults` constant (or `undefined` next-page metadata) at the end instead of a hand-rolled flag; a `{ completed }` metadata field can short-circuit the next call; thread `collectedIds` through metadata to dedupe across pages when the site repeats entries. Build the `URL` with `.setQueryItem(key, values[])` (it accepts a `string[]`) for repeated params instead of indexed `key[0]`/`key[1]` keys.

### Chapters, access & locked content

- Use authoritative lock flags (`isLocked`/`isPermanentlyLocked`) for visibility; do not require `isAccessible === true` (unlocked chapters may omit it).
- A "show locked chapters" setting may reveal records marked locked, but must not bypass non-public status or unrelated access restrictions.
- Reader methods **throw clear errors** for coin locks, permanent locks, short-link locks, empty page lists, malformed payloads, and failed requests — see [Error Handling](#4-cloudflare--error-handling).

#### Text / novel chapters

- **Return an HTML chapter, not pages.** For a novel/light-novel/web-serial source, `getChapterDetails` returns `ChapterDetails { type: "html", id, mangaId, html }` instead of `pages: string[]`, and `mangaInfo.contentType` is set to `"novel"` (manga sources omit `contentType`). `mangaId`/`chapterId` are still the identifiers even for novels.
- **Wrap the body in a namespaced XHTML skeleton** the reader (Readium) accepts: `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${body}</body></html>`, with the chapter title as an `<h2>` heading. **Self-close void elements** (`<br>`, `<img>`, `<hr>`, …) — Readium's XHTML parser rejects them unclosed. `cheerio.load(html, null, false).html({ xml: true })` self-closes them; a hand source needs a `fixVoidElements` pass (keep the void-tag list in `models.ts`). Escape plain-text lines and normalize `&nbsp;`/NBSP.
- **Number serial chapters by list position** (`chapNum: index + 1`) when the title carries no number; mark the source's own chapters with a distinct `version`.
- **Mark novel sources in pbconfig** with `badges: [{ label: "Novel", textColor: "#ffffff", backgroundColor: "#3baf4b" }]`; manga sources use `badges: []`.

---

## 4. Cloudflare & Error Handling

### Never swallow meaningful failures

- **Every catch on a request/parse/reader path must re-throw Cloudflare and let lock/paid errors propagate.** In each such catch: `if (error instanceof CloudflareError) throw error;`. Never a blanket `catch {}` and never a `Promise.any`-style swallow that hides a coin/lock/paid/empty-reader error the user needs to see. (niclimcy)
- Errors that must reach the user are **thrown** with a useful message and the original preserved as `cause` (`new Error(msg, { cause })`) — never hidden in `console.log`/`console.error`. Keep the parsing try/catch tight. Request-level catches for deliberate retry/fallback/state cleanup are legitimate; logs for intentionally non-fatal background work are fine. The rule is "don't hide a failure the user needs," not "never catch a request."
- Reserve `try/catch` for operations that genuinely throw (`decodeURIComponent`, `new URL`, network). Do not wrap non-throwing SDK calls (`Application.setState`/`getState`).

### Centralized Cloudflare detection

- **Detect the challenge once, in `interceptResponse`** — not via a scattered per-call `throwOnCF` flag. Throw with the _challenged request's_ url and method, not the bare domain: (niclimcy/both)

```ts
throw new CloudflareError({
  url: request.url,
  method: request.method ?? "GET",
  headers: { "user-agent": await Application.getDefaultUserAgent() },
});
```

- Prefer one shared detection: header `cf-mitigated === "challenge"` (optionally combined with a 403 and a challenge-title regex).
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

- **This filter is NOT universal — verify against the site.** A server-rendered app (Laravel, etc.) binds the challenge to server-side session cookies too: forwarding only `cf*` drops the session and every post-bypass request 403s. Forward **all** cookies for such sites (OniSaga: `onisaga_session`/`XSRF-TOKEN`). A DDoS-Guard site names its cookies `__ddg*`, not `cf*`, so a `cf`-prefix filter would discard them entirely — filter by domain or forward all (Ranobes). Match the cookies the site actually sets.
- **Present one browser identity everywhere.** The clearance cookie a challenge webview earns is bound to the UA that solved it (full Mobile Safari), while `Application.getDefaultUserAgent()` returns a bare iOS WebView UA. If native requests send a different UA the clearance is rejected and the source loops on the challenge forever. Complete the missing Safari tokens once and use that same UA for both the `CloudflareError` and every request (see OniSaga/Ranobes `completeMobileSafariUserAgent`).
- **Mirror failover for multi-domain sites.** When a source is reachable through alternate domains that get blocked independently, keep an ordered mirror list, fall through to the next host when the current one fails, and remember the host that last worked so later requests skip dead mirrors (Ranobes ranobes.net ↔ ranobes.top). Re-throw `CloudflareError` instead of failing over — a challenge is not a dead host.

### Interceptors & rate limiting

- Register interceptors in `initialise()` via `<interceptor>.registerInterceptor()`. Request interceptors run in **registration order**; response interceptors run in **reverse** — place the rate limiter deliberately (no fixed "must be last" rule).
- Interceptor class name is unique per source (e.g. `KingOfShojoInterceptor`).
- Rate is a per-site choice — guideline presets are strict ≈1/s, balanced ≈3/s, loose ≈10/s; "adjust as needed."
- **Construct the limiter as `new BasicRateLimiter("<id>", { numberOfRequests, bufferInterval, ignoreImages: true })`** — an inline class field with a stable string id. `ignoreImages: true` keeps page-image loads off the API budget. Field names are **not** standardized across maintainers (`globalRateLimiter`/`rateLimiter`, `requestManager`/`interceptor`) — match a neighbor, don't bikeshed.
- **`interceptRequest` stamps a baseline on every request:** `referer: \`${DOMAIN}/\``and`"user-agent": await Application.getDefaultUserAgent()`, plus `origin`+ JSON`accept` for API/JSON calls. Spread over the incoming request (`{ ...request, headers: { ...request.headers, ... } }`).
- **Persist cookies with a dedicated `new CookieStorageInterceptor({ storage: "stateManager" })`**, registered in `initialise()` alongside the limiter and request interceptor; in `cloudflareBypassCompleted`, `.setCookie(c)` per incoming cookie (skip expired via `c.expires`). This is the store the `cf*`-filter snippet above writes into.
- Request body must match its `Content-Type` (URL-encoded string, not an object, for `x-www-form-urlencoded`).

---

## 5. Caching / Memoization

- **Memoized session caches use a class-level promise field**, filled with `??=`, awaited to dedupe concurrent section calls: (celarye)

```ts
private genresPromise?: Promise<string[]>;
// ...
const genres = await (this.genresPromise ??= fetchGenres());
```

- **Reset volatile memos to `undefined` in `cloudflareBypassCompleted`**, and on a base-url change — on base-url change also call `Application.invalidateDiscoverSections()`.
- **Name the field `…Promise`**, never `…Cache` / `…Request` / `…Items`. Use `undefined`, never `null`.
- Static reference data (genres/taxonomies) persists per extension load. A volatile homepage memo may self-clear after use.
- Expose plain fetch functions returning `Promise<T>` **without** a `try/catch`, so Cloudflare-bypass errors propagate. No TTL/timestamp wrapper machinery — store scraped lists in `Application` state directly.
- No low-value, context-bound caches: an in-memory `Map` dies with the JS context; drop caches for short-lived data or items already shadowed by an earlier check. No request-specific mutable state on the instance (races under out-of-order calls). Parallelize independent fetches with `Promise.all`.
- **`Application.setState(value, key)` takes the value FIRST, the key SECOND** — `getState(key)` takes the key alone. Reversing them silently writes to the wrong slot (a recurring real bug). Clear a value with `setState(undefined, key)`; namespace keys `<source>_<name>`; read as `(Application.getState(key) as T | undefined) ?? default`.
- **Call `Application.invalidateDiscoverSections()` from any settings handler that changes discover output** (section toggles, hidden genres, content-type) — not only on a base-url change. After a reset/toggle that changes the form itself, call `this.reloadForm()`.

---

## 6. IDs & Sanitization

- **Sanitize every id at every id-producing call site.** Paperback rejects ids containing characters outside its allowed set, and an unsanitized character (e.g. an apostrophe in a tag slug) crashes the app. Sources are self-contained, so each defines the same canonical constant rather than importing a shared module: (both)

  ```ts
  // Paperback rejects ids containing characters outside this set.
  const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;
  ```

  Keep this constant byte-identical across sources — case-preserving, global (`/g`), no Unicode (`u`) flag. Two sanctioned replacement modes over this one charset: **dash-replace** (`.replace(SAFE_ID_REGEX, "-")`, most sources) or **preserve-by-encoding** (a callback that returns `encodeURIComponent(c)` when it differs, else `"-"` — keeps more of the original, used by KingOfShojo/RinkoComics). Pick one per source and keep it stable — changing an id format breaks users' saved library entries. This is distinct from a **narrow slugifier** (`[^a-z0-9]+ → "-"`, used for human-readable tag/team slugs in OManga/OniSaga/ScansGG) — a different purpose, not the id sanitizer.

- **IDs must be unique and self-sufficient** — carry everything needed to re-fetch (e.g. keep the absolute mirror URL in the id) rather than stashing values in `additionalInfo`. Never derive a `chapterId` from a non-unique bare number.
- Encode/decode each id exactly once. Normalize URL-derived `chapterId`s — a stray leading slash wipes saved reading progress.
- No legacy-migration / self-healing re-resolution loops for old id formats in new sources.

### Parsing correctness

- **Brace/JSON slicing over decoded payloads must be string-aware** — track `inString`/`escaped` so brackets inside string values don't desync bracket depth. Unescape only what the transport escaped. Parse only verified delimiters and field orders. (niclimcy)
- **Parse only verified delimiters.** Don't split titles/creator names on convenient punctuation (commas can be part of a title); use delimiters observed in the live payload (slash, pipe, newline).
- Avoid speculative cleanup — normalize whitespace and known placeholders, but don't strip site text with unverified regexes.
- **Synthetic dates must be stable across fetches.** When the payload carries no chapter/update date, anchor ages to the title's own update time, or to a first-load timestamp persisted in `Application` state — never `Date.now()`/`new Date()` at parse time, which makes the whole list re-sort on every refresh.
- Reuse the API's base response type instead of re-declaring a narrower interface that only restates optional fields as required.
- One generic list parser (`parseMangaList`) returning a generic item shape; the section handler switches on item type and maps at the call site.

### Defaults & optionals

- **`?? default`, never `|| default`, where `0`/`""`/`false` is a valid value.** (niclimcy) Use the correct default (`?? "or"`, not `?? true`).
- Guard optional fields (`chapter.images ?? {}` before `Object.entries`). Never leak `(string | undefined)[]` into a `string[]` field — filter/guard `$(el).attr("src")` maps before assigning to `pages`.
- **Run scraped display text through `Application.decodeHTMLEntities(...)`** — titles, secondary titles, subtitles, synopsis, author/artist, chapter names — at the parser boundary.
- **Read cover/thumbnail URLs from lazy-load attrs first** (`data-src`/`data-lazy-src`/`data-cfsrc`/`srcset`) before the placeholder `src`.
- **Validate scraped JSON with a type-guard (`isX(v): v is X`) before casting**, rather than a blind `as X` on shape-uncertain payloads (e.g. Next.js flight data).
- **Source real chapter dates** from the site's own field (`<time datetime>`, epoch-millis) and keep the no-`Date.now()`-at-parse rule above.

---

## 7. pbconfig & Metadata

- **Version scheme `1.0.0-alpha.N`, bumped on every change.** Every modified existing source gets a bump (PR-template requirement); a new source starts at `alpha.1`; a revived source bumps from its old version, not a reset. (celarye) [policy]
- **Consistent `capabilities` ordering** across sources. ALL_CAPS constants throughout.
- **Single-line import:** `import { ContentRating, SourceIntents, type ExtensionInfo } from "@paperback/types";`.
- **Single consistent developers block:** `{ name: "PopMango", github: "https://github.com/PoppingMangoSources" }`. Real, useful support contact — no bare non-copyable URLs.
- `contentRating` and `language` are **per-site**. `language` is a lowercase ISO code (`en`), no flags/uppercase. Source-level `contentRating` is MATURE/ADULT if any meaningful subset is.
- **Per-title `mangaInfo.contentRating`** comes from that title's own data, set once at the app-return boundary; source default only as fallback. This is distinct from the pbconfig source-level rating.
- **Derive it with one shared pure `contentRatingForGenres(names)`** — lowercase the title's genres and escalate `EVERYONE → MATURE → ADULT` against adult/mature name lists (or an on-page 18+ badge). **Never emit below the source default** (`defaultContentRating === ADULT ? ADULT : derive(...)`). Reuse the same function for both the details boundary and discover/search items so badges match; items whose listing carries no genres default to `EVERYONE` (comment why) or the source's global adult toggle.
- **Prefer `Application.getDefaultUserAgent()`** over a hardcoded UA unless the site requires a pinned one — document why if so. (celarye)
- There is no `id`/`author`/`websiteBaseURL` in 0.9 pbconfig — the dir name is the id; the base URL lives in code.
- Forms: `SelectRow` uses `items` + `layout` (not deprecated `options`); `maxItemCount` reflects real selection semantics (`1` for single-select), not the option count. No `FormState` class pattern. Use current `ExtensionImpl` and non-deprecated `SourceIntents` only; use Paperback types directly (no re-export/re-wrap); use the `URL` class for dynamic path building.
- **Wire every form-row callback with `Application.Selector(this as <ConcreteForm>, "handleX")`** (or a `closureSelector(this, "id", async (v) => …)` for inline handlers — one style per form). The `this as <ConcreteForm>` self-cast is required, and the named handler must be a real `async` method on that class. Tri-state genre filters use `TriStateSelectRow` (`allowExclusion`/`allowEmptySelection`, value `Record<string, "included" | "excluded">`).
- **AdvancedSearchForm skeleton:** one private field per metadata key seeded from `searchQuery.metadata ?? {}` in the constructor, one `handleXChange` per field, and a sparse `getSearchQueryMetadata()`. Prefer the native `AdvancedSearchForm` over the `@paperback/types/lib/compat/0.8` `SearchFilterForm` shim (a temporary migration wrapper).
- **Sorting:** keep the site's sort token as `value` on an `as const` `SORT_OPTIONS`; `getSortingOptions` exposes only `{ id, label }`; translate id→token with a small mapper at the call site.
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

- Conventional Commits, **scope = the source name**. Commit type = highest semver impact: `feat`/`refactor` > `fix` > `chore`.

### Verification gate (run before declaring work done / opening a PR)

- **`npm run conformance` must pass** — `tsc` + `oxlint --type-aware --deny-warnings` + `oxfmt`. This is also the pre-push hook. Type-only imports use `import type`; leave imports in oxfmt's sorted order. No `new Array(n)` (use `Array.from({ length: n })`).
- **Format with `oxfmt` (`npm run format`), never Prettier.** Prettier's output differs from `oxfmt` (import sorting, wrapping) and fails `format:check`; don't reach for it even when it's the muscle-memory default.
- **`npm test` must pass.** Generate tests via `npx paperback-cli test --generate <Name>` — don't hand-write fixtures. Default tests cover `initialise → getSortingOptions → getSearchResults → getMangaDetails → getChapters → getChapterDetails` only; **manually verify Discover sections and settings forms in-app.**
- **Test on a device with `npm run dev`** (phone + computer on the same network → add the printed `http://<lan-ip>:8080/` as a repo; hit reload to reinstall, no version bump needed). Note Paperback will "update" between any two same-name extensions whose version strings merely differ — even downgrades — so be deliberate with the published `alpha.N`.
- New source (or removal / branding / domain change) → update the root README "Sources" list. Maintainers block on a missing entry.
- Don't edit the PR template; explain any test failure under the summary block instead. A green PR still needs ≥1 maintainer approval.

### Source review checklist

- Confirm the diff is a direct base-to-head tree diff; account for a diverged merge base. Separate real source changes from version bumps, lockfile/formatter churn, generated bundles, and other-source edits.
- Confirm every Discover section returns the intended titles, card type, metadata, ordering, and next page; check that listings do no per-item detail requests.
- Test empty search, ordinary text search, pasted source URLs, sorting, included genres, excluded genres.
- Test public unlocked chapters, optionally-shown locked chapters, non-public chapters, and empty/locked reader responses.
- Confirm IDs are encoded/decoded exactly once and remain sufficient for later requests.
- Verify the required version bump and SPDX headers.

---

## 10. Project-Specific Deviations

Deliberate, owner-approved departures from the rules above. Do not replicate these into new sources without the same justification.

- **KingOfShojo — per-card detail fetch in `buildFeaturedItems`.** The [no per-item detail fan-out](#no-per-item-detail-fan-out) rule is intentionally violated here: the site's "Popular Today" listing payload carries **no adult signal**, and per-item adult filtering is required, so each featured card is fetched for its details. This is a deliberate, owner-approved deviation — not a template for other carousels. (niclimcy)
- **KingOfShojo & RokariComics — theme placement pending.** Both are MangaStream-themed and would normally live in the MangaStream theme repo extending its generic base (RokariComics additionally vendors a local `generic/`). They remain here pending a maintainer placement decision (see [Theme Placement](#8-theme-placement)). Treat their presence as provisional.
