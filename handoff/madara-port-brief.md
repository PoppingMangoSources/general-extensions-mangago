# Brief: port BunManga and RinkoComics to a Madara theme repo

## Context

`PoppingMangoSources/general-extensions-mangago` (branch `0.9/test`) contains two sources that
target **Madara**-themed WordPress sites. Under the inkdex placement rule they cannot be submitted
to `inkdex/general-extensions` — a bespoke reimplementation of a themed site is an automatic
rejection. They belong in a Madara theme repo, extending the shared generic base.

This is a **rewrite, not a port.** Do not carry the existing implementations over. Each site
becomes roughly twenty lines against the generic base; the current bespoke sources are ~1,290 and
~1,090 lines and all of that logic already exists in the base.

| Source      | Site              | Current size         | Evidence it is Madara                                                                                                      |
| ----------- | ----------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| BunManga    | `bunmanga.com`    | 1,291 lines, 6 files | `madara_load_more`, `madara-core/content/content-search`, `POST /wp-admin/admin-ajax.php`, `var __madara_query_vars = {…}` |
| RinkoComics | `rinkocomics.com` | 1,093 lines, 6 files | `AJAX_ENDPOINT = ${DOMAIN}/wp-admin/admin-ajax.php`                                                                        |

Reference implementation to copy the shape from: `inkdex/madara-extensions` at branch
`0.9/stable`, which currently carries 29 sites in this form.

## Target shape

A site is **three files**: `main.ts`, `pbconfig.ts`, `static/icon.png`. Nothing else unless the
site's markup genuinely deviates.

`src/<Name>/main.ts` — params-object dependency injection into `MadaraGeneric`:

```ts
/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { MadaraGeneric } from "../generic/main";
import pbconfig from "./pbconfig";

const DOMAIN: string = "https://bunmanga.com";

class BunMangaExtension extends MadaraGeneric {
  constructor() {
    super({
      domain: DOMAIN,
      name: pbconfig.name,
      contentRating: pbconfig.contentRating,
      language: pbconfig.language,
      usePostIds: true,
    });
  }
}

export const BunManga = new BunMangaExtension();
```

`src/<Name>/pbconfig.ts` — mutate the shared base, never redeclare it:

```ts
/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ContentRating } from "@paperback/types";

import { basePbConfig } from "../generic/config";

let pbConfig = basePbConfig;

pbConfig.name = "BunManga";
pbConfig.description = "Extension that pulls content from bunmanga.com.";
pbConfig.contentRating = ContentRating.MATURE;

export default pbConfig;
```

Versioning **inverts** the per-source rule used in general-extensions: `BASE_VERSION` lives in
`generic/config.ts` and is bumped once for base changes. A site that needs its own bump adds
`pbConfig.version = customVersion({ increasePrerelease: N })`; a site with no override omits
`version` entirely and inherits the base.

The class name is `<Name>Extension`, and the exported const must equal the directory name.

## Knobs available on `GenericParams`

Every one defaults, so pass only what the site actually needs. Read `generic/main.ts` for the
authoritative list and current defaults before assuming:

`domain`, `name`, `contentRating`, `language`, `usePostIds` (default `true`),
`searchPagePathName` (`"page"`), `searchMangaSelector` (`"div.c-tabs-item__content"`),
`searchRatingSelector` (`"span.score"`), `hasProtectedChapters` (`false`),
`protectedChapterDataSelector` (`"#chapter-protector-data"`), `chapterEndpoint` (`3`),
`chapterDetailsSelector` (`"div.page-break > img"`), `bypassPage` (`""`), `directoryPath` (`""`),
`useListParameter` (`true`), `userAgent`, plus `parser` and `requestManager` collaborators.

## When the site really does deviate

Add a `parsers.ts` exporting a `<Name>Parser extends MadaraParser` and pass
`parser: new <Name>Parser()`. `ArthurScan` is the worked example — it overrides search/discover
markup for a "Madara X" skin and Portuguese chapter dates, and its file opens with a two-line
comment naming exactly what deviates and why. Override the smallest surface that works; do not
copy whole methods to change one selector.

## What to salvage from the existing sources

Only the site-specific facts, not the code:

- **BunManga** — confirm `usePostIds`, the `chapterEndpoint` value, and whether the search markup
  matches the default `div.c-tabs-item__content`. The existing `parsers.ts` reads
  `__madara_query_vars` for load-more pagination; check whether the base already handles that
  before writing an override.
- **RinkoComics** — it currently uses the **preserve-by-encoding** id sanitizer rather than
  dash-replace. Whatever the base does is what the ported source does; do not port the custom
  sanitizer, and be aware the id format will change for anyone with an existing library entry.
- Both — carry over `contentRating`, `language`, and the icon only.

## Definition of done

1. `src/<Name>/{main.ts,pbconfig.ts,static/icon.png}` exist and nothing else, unless a documented
   `parsers.ts` override is genuinely required.
2. SPDX + copyright header on every `.ts` file.
3. `src/tests/<Name>.ts` generated with `npx paperback-cli test --generate <Name>` and containing
   **only** `registerDefaultTests(suite, <Name>, sourceInfo)` — three arguments, no options object,
   no custom `suite.test(...)` cases.
4. Root README source list updated.
5. `npm run conformance` passes (`tsc` + `oxlint --type-aware --deny-warnings` + `oxfmt --check`).
   Format with `oxfmt`, never Prettier.
6. `npm test` passes.
7. Verified on device with `npm run dev`: discover sections, search including genre filters,
   details, chapter list, and the reader.

## Do not

- Copy any of the ~2,400 lines from the two existing sources.
- Add `network.ts`, `models.ts`, `forms.ts`, or `utils.ts` to a site directory.
- Redeclare `basePbConfig` fields the base already sets (`icon`, `capabilities`, `badges`,
  `developers`).
- Introduce a per-site rate limiter or interceptor; the base owns both.
