# Inkdex merge standards

What a source must look like to merge into `inkdex/general-extensions`. Every rule carries its
evidence: a PR number is a review comment on that inkdex PR, a commit hash is a maintainer change
on `upstream/0.9/stable`, **(niclim)** is the AGENTS.md niclimcy sent us, **(celarye)** inkdex's
lead, **(Seyden)** the Mana developer, **[policy]** inkdex `CONTRIBUTING.md` or the PR template,
**[platform]** `platform.md`, and **[check]** means `scripts/check-sources.mjs` enforces it.
`evidence.md` quotes the comments.

When examples disagree, trust in this order: the live site's contract, niclim's guide and current
review comments, a recent maintainer rewrite (HiveToons `a3face6`, FlameComics `e424b7c`,
MangaFire `225a974`, Mangago `173bccd`, AllManga `c064615`), then older merged code. A merge
shows a patch was acceptable, not that every line around it is a standard; LNori's June review
(#230) still asked for a parser class, which niclim's later guide replaced.

## 1. Placement and metadata

- A site on a generic theme (Madara, MangaStream/MangaReader, …) belongs in that theme's inkdex
  repository on its shared base. Only unique sites belong here. **[policy]**
- `name` is the site's branding with no spaces, matching the directory: celarye renamed
  `Punk Records` to `PunkRecords` "to match naming guidelines" (#186). Directory and class are
  PascalCase. **[check]**
- The icon is the site's logo, a square PNG at `static/icon.png`. **[policy] [check]**
- `description`: `Extension that pulls content from <domain>.`, in the site's language (#156
  asked for French on a French site). It is the one text a reader sees before installing, so
  anything they must set (Chapters Unique by Volume) goes there. **[platform]**
- `language`: lowercase IETF tag or `multi`; metadata only, so a multi-language source still needs
  a language setting. **[check]**
- `capabilities` is an array of `_PROVIDING` intents (#230). **[check]**
- `contentRating` is the source's presence flag (`MATURE` if any meaningful share is mature),
  not a per-title floor. Set the right default before the PR.
- `developers`: `[{ name: "Popmango", github: "https://github.com/PoppingMangoSources" }]`.
- Novel sources carry `{ label: "Novel", textColor: "#ffffff", backgroundColor: "#3baf4b" }`;
  others `badges: []`.

## 2. Files (niclim)

```
src/<Name>/
  main.ts       the ExtensionImpl class and `export const <Name> = new <Name>Extension()` [check]
  models.ts     types, interfaces, constants, SECTIONS; each DOMAIN/API_URL once [check]
  network.ts    fetch functions, API calls, the interceptor
  parsers.ts    HTML/JSON parsing and mappers
  forms.ts      form classes; forms/search.ts + forms/settings.ts once it grows
  utils.ts      heavy machinery only: descramblers, decryptors, ciphers
  pbconfig.ts   metadata, `satisfies ExtensionInfo`
  static/icon.png
src/tests/<Name>.ts   the generated baseline, unchanged [check]
```

- `main.ts` is the class only (#244 "main.ts should be self contained and only have the extension
  class"); constants move to `models.ts` (#238 "why is this here? move to models.ts", #230, #246).
- A canonical file may become a directory; one holding a single file is a file. No other
  top-level names. **[check, note]**
- Very large sources: `implementations/<feature>/` each with `main.ts`/`models.ts`/`parsers.ts`/
  `utils.ts` (and `forms.ts`), optional `implementations/shared/`, top-level `main.ts`,
  `pbconfig.ts`, `static/icon.png` and `services/network.ts`. Do not start a source this way.
- The repository `src/utils/` is for code several sources share. **[policy]**
- Every implementation file starts with the GPL-3.0-or-later and `Copyright © 2026 Inkdex`
  header (#185 "Add license headers to all files"). **[check]**

## 3. Code shape

- Free exported arrow functions (`parseX`, `buildX`, `toX`), file-local `const` arrows (niclim).
  Merged Mangago and AllManga still use `function`; never mix the two in one file. **[check, note]**
- Classes only where the framework needs them: `ExtensionImpl`, `PaperbackInterceptor`, SDK form
  subclasses (niclim). No `Api` class for plain GETs (#185, `e424b7c` deleted `FlameApi` and
  `FlameParser`), no classes of static methods calling free functions (celarye), no base classes
  for sharing helpers. **[check]**
- No request state on the instance: handlers run out of order and race (#185).
- Inline wrappers that rename, unwrap, add `?? default` or delegate one call; no wrapper of a
  wrapper (#156); a constant or mapper used once is written at its use (#238). Delete dead code.
- One generic list parser returning one item shape; handlers switch on the item type at the call
  site (niclim; HiveToons merged with one `parseMangaList` replacing five mappers).
- Use `cheerio` for HTML (#156). `cheerio.Cheerio<AnyNode>`; never `any` **[check]**, no casts
  without a reason (#219 "why random typecast here?"), no `as DiscoverSectionItem` **[platform]**.
- Use `@paperback/types` directly; never re-export it (#156) **[check]**; build paths with its `URL`
  class (#156, #120).
- Default `query.metadata` once with a full object (#152).
- `try/catch` only around what throws. No catch that only rethrows `String(e)` (#152) **[check]**;
  an empty catch needs a comment saying why the data is optional **[check]**. Let errors reach
  Paperback (celarye on #210).
- No global patches of SDK prototypes to hide app behaviour (niclim on #192, `Form.prototype`).
- Do not reproduce a site's confusing control just because the site has it (niclim on #264: "site
  does it, doesn't mean we have to replicate it"); celarye found the same code "tricky to follow".
- Comments say why, in a line; no boilerplate (#238 "remove comments like this"), dividers
  **[check]**, JSDoc narration or commented-out code. No `console.*` **[check]**.
- Names match what they hold (#185, #142); format with the repository's oxfmt, not an IDE
  formatter (#208, #246, #271).

## 4. Requests and Cloudflare

- Every request goes through `Application.scheduleRequest` **[check]**; one fetch helper per
  payload kind checks `response.status !== 200` (a 2xx range is a note **[check]**), decodes with
  `Application.arrayBufferToUTF8String`, parses.
- Send object bodies as `JSON.stringify(body)`: the bridge turns `0` into `false`. **[platform]
  [check, note]**
- Rate limit every source: strict 1/s, balanced 3/s, loose 10/s **[policy]**; `bufferInterval` is
  seconds; extensionless image URLs are not skipped by `ignoreImages` **[platform]**. No
  hand-rolled pacing (`173bccd`); `setTimeout` does not exist on the device **[check]**.
- `interceptRequest` sets `referer` and `user-agent`; it runs on the first request only, so
  re-apply headers in `setRedirectHandler` when redirects need them (Mangago). **[platform]**
- Detect Cloudflare once, in `interceptResponse`, and throw `CloudflareError` for the challenged
  request (the site root for a JSON path). No second check elsewhere (#238). Every other catch on a
  request path rethrows `CloudflareError`.
- `cloudflareBypassCompleted(request, cookies, localStorage)` stores the cookies the site needs in
  a `CookieStorageInterceptor({ storage: "stateManager" })` and resets memo promises
  (`75274b7`). Cookies without `expires` do not survive a restart. **[platform]**
- WebView requests bypass interceptors: rate limit and pass cookies yourself (MangaFire).

## 5. Discover, search and pagination

- `getDiscoverSectionItems` is a thin switch or map on `section.id`; one parameterised handler
  covers sections that differ by a token (MangaFire). Section ids live in one `as const` `SECTIONS`
  object (niclim's HiveToons rewrite replaced `SECTION_*` constants).
- **One request per section; never a detail request per card.** niclim removed HiveToons'
  `.slice(0, 8)` plus `Promise.all` detail fetch and mapped the listing payload. **[check, note]**
- Paging follows the API's own signal; no `.slice()` caps or invented sizes; advanced search
  pages too (#214). `hasMore` from the unfiltered page.
- **Never put `undefined` in `Metadata`** (paging state, form results, chip `searchQuery`): omit
  the key; the bridge crashes on it. **[platform] [check, note]**
- An empty search must return results: the default test searches `{ title: "" }`. **[platform]**
- Wire every filter in the site's casing, exclusions included; say in the form when title search
  and filters cannot combine (#214). A details tag id comes from the same function as the filter
  option (`173bccd`).
- Sorts: the app has no direction toggle, so list each field and direction as one option.
- A setting that applies to every list is applied once at the dispatcher.

## 6. Chapters and readers

- The site's real chapter id; never a count or position.
- Keep chapter numbers, volumes, groups and dates from the site; no `Date.now()` at parse time
  **[check, note]**. `volume: 0` when the site has none (unset shows "Vol. TBA"); strip a leading
  number from `title` (the row reads "Chapter N - title"); `version` labels duplicate uploads;
  keep `chapNum` monotonic, `sortingIndex` did not reorder the list in a device test. **[platform]**
- One access predicate (`isLocked || price > 0 || …`) for lists, labels and reader guards
  (HiveToons `c9fa802`). Keep locked chapters listed; opening one throws a message saying why. The
  default test opens `chapters[0]`, so a locked newest chapter fails it.
- Build page lists from a total and a URL template, not a next-page walk (`173bccd`).
- Novels: `{ type: "html" }` in a namespaced XHTML document, XML-safe entities, void elements
  closed; `contentType: "novel"`. Validate with `xmllint --noout`. **[platform]**
- Pass images through untouched; GIFs animate.

## 7. Ids

- Self-sufficient (niclim) and small (Seyden): the shortest stable key the site has, never a full
  URL, since the manga id is stored on every chapter. Keep a mirror host in the id only when the
  site serves a title from varying hosts.
- Sanitise every id-typed field (manga, chapter, `Tag.id`, section ids, form row ids) with the
  canonical `const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;` (#214 "app does not
  accept id values outside of those in the regex"). **[check]**
- Encode and decode once; no legacy-migration loops in new sources (niclim).

## 8. State and caching

- `Application.setState(value, key)`, value first **[check, note]**; clear with `undefined`, not
  `""` (celarye on #196) **[check, note]**; `0` reads back as `false`.
- No second cache over app state (#196 "no point having 2 layers of caching"), no in-memory `Map`
  caches, no TTL for stable data. A taxonomy that does not change is a constant (`173bccd`); one
  that does is `await (this.genresPromise ??= fetchGenres())`, reset on bypass (niclim; HiveToons).
- Tokens go in `getSecureState`/`setSecureState` (MangaDex).
- `Application.invalidateDiscoverSections()` after settings that change Discover.
- Settings accessors live in the forms layer; no `FormState` class (#156) **[check]**; do not pass
  the extension into a form (#156).

## 9. Forms and text

- `SelectRow` takes `items` and `layout`; `options` is deprecated (MangaFire still uses it, so a
  note). **[check, note]** `maxItemCount` matches the selection.
- Callbacks: `Application.Selector(this as ConcreteForm, "method")`; the object must stay
  referenced. Rows filled from the network: fetch in `formDidAppear`, then `reloadForm()`.
- Functional text is text: `Locked`, `English`; `★ 8.9` is fine. Merged sources still carry a lock
  emoji (HiveToons) and flag emoji (MangaFire), so emoji are a note, but `langCode` is an IETF code
  (#246). **[check, note]**
- `MangaInfo.rating` is 0..1. Run scraped text through `Application.decodeHTMLEntities`
  (`3cc4d2b`).

## 10. Tests, versions and commits

- `src/tests/<Name>.ts` is exactly the generated baseline (#238 "no need to define custom manga
  for test suite"). **[check]** Our deeper tests live in `test/unit/`, which never ships.
- Every change bumps `version`; new sources start at `1.0.0-alpha.1`. **[policy] [check]**
- Commit type is the highest semver impact (celarye on #192); `type(Scope): summary`.
- AI-assisted submission commits end with one trailer naming each tool and model, space-separated:
  `Assisted-by: ClaudeCode:<model> Codex:<model>` (niclim on #192, #156); tick the template's AI box.
- A new source, removal, rename or domain change updates the README list (#185). **[check]**
- Keep the branch linear: never merge `0.9/stable` into it (#156 "Why did you merge stable into
  dev? no"); rebase, and expect a maintainer to squash or push to it.
