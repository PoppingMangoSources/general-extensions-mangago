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

### Function-based design

- Parsers and API logic are free exported arrow functions (`parseX`, `buildX`, `toX`); file-local helpers are `const` arrow functions.
- **Classes only when the framework requires them:** the `PaperbackInterceptor` subclass and the `ExtensionImpl` subclass. No "Api" class for plain REST/Next.js GETs — use plain fetch helpers (`fetchNextData<T>`) + URL builders. No base classes to share small utility methods; use free functions taking instance args (`saveSetting(form, key, value)`).

### Simplification

- Delete dead/uncalled code aggressively (builders, constants, types, helpers). [policy]
- Inline single-use constants and trivial wrappers (a body that just renames, `?? default`, unwraps, or delegates one call). Collapse wrapper-of-wrapper helpers. Return new objects rather than mutating inputs.
- Prefer native array methods (`.map`/`.filter`/`.reduce`); `for...of` is also fine. Use `cheerio` for HTML — never hand-rolled parsing.

### Comments & naming

- Terse, non-obvious "why" comments only. **No boilerplate / "standard across all extensions" comments** — the top review tell. Document a shared pattern once at most, never per-file. No commented-out code (use a real `// TODO` or delete). No decorative dividers or empty docblocks.
- Clean, grammatical, typo-free names. Avoid names that read as a JS global (`data`, not `json`). PascalCase dirs/classes; ALL_CAPS option constants; kebab-case implementation subdirs.
- Cheerio typing: root `$: cheerio.CheerioAPI`; elements `cheerio.Cheerio<AnyNode>` (`import type { AnyNode } from "domhandler"`). **Never `Cheerio<any>`.**

---

## 3. Discover, Search & Pagination

### Discover dispatch

- **`getDiscoverSectionItems` is a thin `section.id` switch** that delegates to focused handler methods. No inline fetch/parse/map in the dispatcher. (niclimcy) [policy]
- **`SECTIONS` is an `as const` object in `models.ts`.** No inline section-id string literals anywhere; reference `SECTIONS.POPULAR` etc. Prefer one grouped `as const` object over parallel `SECTION_*` constants. (both)

### No per-item detail fan-out

- **Never fan out into one detail request per carousel/listing item** (`Promise.all(cards.map(getDetails))`). Build carousels/listings from the listing payload, which already carries the needed fields. An N+1 section stalls the whole carousel and amplifies rate-limit/Cloudflare failures. (niclimcy) See the documented exception in [Project-Specific Deviations](#10-project-specific-deviations).

### Search & pagination

- **Omit empty query params.** Never send placeholders like `searchTerm=""`, `s=""`, or `author=""`. Add an optional param only when it has a value. (niclimcy)
- **Use server-side filters when the API has them** — send both included and excluded genre IDs. Only crawl-and-filter client-side when the API genuinely lacks the filter. (niclimcy)
- **Pagination derives from the API contract.** Read incoming page metadata, request the configured page size, and return next-page metadata from `totalCount`/the site's cursor. Don't hardcode page 1, cap with `.slice()`, or use an arbitrary smaller page size unless the UI contract requires it.
- **`hasMore` derives from the UNFILTERED server count/length.** When filtering locally, filter first, then slice/page from the filtered candidate set. (niclimcy)
- **Keep search metadata sparse** — `getSearchQueryMetadata` returns only non-empty fields; no empty arrays or empty genre maps.
- **URL-paste lookup is an optional fast path.** Match only supported source URLs, encode the slug once, and return `undefined` when it can't resolve so ordinary text search continues. Do not use blanket error suppression on normal API/parser/reader paths.

### Chapters, access & locked content

- Use authoritative lock flags (`isLocked`/`isPermanentlyLocked`) for visibility; do not require `isAccessible === true` (unlocked chapters may omit it).
- A "show locked chapters" setting may reveal records marked locked, but must not bypass non-public status or unrelated access restrictions.
- Reader methods **throw clear errors** for coin locks, permanent locks, short-link locks, empty page lists, malformed payloads, and failed requests — see [Error Handling](#4-cloudflare--error-handling).

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
- Filter forwarded cookies to the `cf` / `_cf` / `__cf` prefixes:

```ts
async cloudflareBypassCompleted(request: Request, cookies: Cookie[], localStorage: Record<string, string>): Promise<void> {
  for (const c of cookies)
    if (c.name.startsWith("cf") || c.name.startsWith("_cf") || c.name.startsWith("__cf"))
      this.cookieStorageInterceptor.setCookie(c);
  // reset memoized session caches here — see §5
}
```

### Interceptors & rate limiting

- Register interceptors in `initialise()` via `<interceptor>.registerInterceptor()`. Request interceptors run in **registration order**; response interceptors run in **reverse** — place the rate limiter deliberately (no fixed "must be last" rule).
- Interceptor class name is unique per source (e.g. `KingOfShojoInterceptor`).
- Rate is a per-site choice — guideline presets are strict ≈1/s, balanced ≈3/s, loose ≈10/s; "adjust as needed."
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

---

## 6. IDs & Sanitization

- **One shared `sanitizeId`** applied at **every** id-producing call site. Allowed charset: `a-zA-Z0-9._-@()[]%?#+=/&`. Case-preserving, global (`/g`). (both)
- **IDs must be unique and self-sufficient** — carry everything needed to re-fetch (e.g. keep the absolute mirror URL in the id) rather than stashing values in `additionalInfo`. Never derive a `chapterId` from a non-unique bare number.
- Encode/decode each id exactly once. Normalize URL-derived `chapterId`s — a stray leading slash wipes saved reading progress.
- No legacy-migration / self-healing re-resolution loops for old id formats in new sources.

### Parsing correctness

- **Brace/JSON slicing over decoded payloads must be string-aware** — track `inString`/`escaped` so brackets inside string values don't desync bracket depth. Unescape only what the transport escaped. Parse only verified delimiters and field orders. (niclimcy)
- **Parse only verified delimiters.** Don't split titles/creator names on convenient punctuation (commas can be part of a title); use delimiters observed in the live payload (slash, pipe, newline).
- Avoid speculative cleanup — normalize whitespace and known placeholders, but don't strip site text with unverified regexes.
- Reuse the API's base response type instead of re-declaring a narrower interface that only restates optional fields as required.
- One generic list parser (`parseMangaList`) returning a generic item shape; the section handler switches on item type and maps at the call site.

### Defaults & optionals

- **`?? default`, never `|| default`, where `0`/`""`/`false` is a valid value.** (niclimcy) Use the correct default (`?? "or"`, not `?? true`).
- Guard optional fields (`chapter.images ?? {}` before `Object.entries`). Never leak `(string | undefined)[]` into a `string[]` field — filter/guard `$(el).attr("src")` maps before assigning to `pages`.

---

## 7. pbconfig & Metadata

- **Version scheme `1.0.0-alpha.N`, bumped on every change.** Every modified existing source gets a bump (PR-template requirement); a new source starts at `alpha.1`; a revived source bumps from its old version, not a reset. (celarye) [policy]
- **Consistent `capabilities` ordering** across sources. ALL_CAPS constants throughout.
- **Single-line import:** `import { ContentRating, SourceIntents, type ExtensionInfo } from "@paperback/types";`.
- **Single consistent developers block:** `{ name: "PopMango", github: "https://github.com/PoppingMangoSources" }`. Real, useful support contact — no bare non-copyable URLs.
- `contentRating` and `language` are **per-site**. `language` is a lowercase ISO code (`en`), no flags/uppercase. Source-level `contentRating` is MATURE/ADULT if any meaningful subset is.
- **Per-title `mangaInfo.contentRating`** comes from that title's own data, set once at the app-return boundary; source default only as fallback. This is distinct from the pbconfig source-level rating.
- **Prefer `Application.getDefaultUserAgent()`** over a hardcoded UA unless the site requires a pinned one — document why if so. (celarye)
- There is no `id`/`author`/`websiteBaseURL` in 0.9 pbconfig — the dir name is the id; the base URL lives in code.
- Forms: `SelectRow` uses `items` + `layout` (not deprecated `options`); `maxItemCount` reflects real selection semantics (`1` for single-select), not the option count. No `FormState` class pattern. Use current `ExtensionImpl` and non-deprecated `SourceIntents` only; use Paperback types directly (no re-export/re-wrap); use the `URL` class for dynamic path building.

---

## 8. Theme Placement

- A site matching a recognized generic theme (MangaStream/MangaReader, Madara, etc.) belongs in **that theme's inkdex repo, extending the shared generic base**. A bespoke reimplementation in general-extensions is a rejection. [policy]
- Only genuinely unique/custom sites are bespoke here.
- **Repo-specific note:** `KingOfShojo` (MangaStream) and `RokariComics` (MangaStream; currently vendors a `generic/` base) are flagged against this rule and are **pending a placement decision by the maintainer**. Do not treat their current in-repo bespoke/vendored form as an endorsed pattern.

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
- **`npm test` must pass.** Generate tests via `npx paperback-cli test --generate <Name>` — don't hand-write fixtures. Default tests cover `initialise → getSortingOptions → getSearchResults → getMangaDetails → getChapters → getChapterDetails` only; **manually verify Discover sections and settings forms in-app.**
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
