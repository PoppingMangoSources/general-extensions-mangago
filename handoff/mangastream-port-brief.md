# Brief: port RokariComics and KingOfShojo to a MangaStream theme repo

## Context

`PoppingMangoSources/general-extensions-mangago` (branch `0.9/test`) contains two sources that
target **MangaStream**-themed sites. Under the inkdex placement rule they cannot be submitted to
`inkdex/general-extensions` — a bespoke reimplementation of a themed site is an automatic
rejection. They belong in a MangaStream theme repo, extending the shared generic base.

This is a **rewrite, not a port.** Each site becomes roughly twenty-five lines against the generic
base.

| Source       | Site               | Current size          | Notes                                                                                                                                                                                                                                                          |
| ------------ | ------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RokariComics | `rokaricomics.com` | 1,760 lines, 11 files | **Already vendors a private copy of the base** at `src/RokariComics/generic/` and extends `MangaStreamSettings` / `MangaStreamGeneric` from it. Also carries a non-canonical top-level `settings.ts`, and its `pbconfig.ts` declares **zero** `SourceIntents`. |
| KingOfShojo  | `kingofshojo.com`  | 1,497 lines, 7 files  | Bespoke reimplementation. Declared `ADULT` with no show-adult toggle. Still carries a per-card detail fan-out in `buildFeaturedItems` (`.slice(0, FEATURED_LIMIT)` + a details fetch per card), now only for card enrichment — do not port it.                 |

RokariComics is the cheaper of the two: the vendored `generic/` is the thing to delete, replaced by
the upstream base. Do not "upgrade" the vendored copy in place.

Reference implementation to copy the shape from: `inkdex/mangastream-extensions` at branch
`0.9/stable`, which currently carries 7 sites in this form.

## Target shape

A site is **three files**: `main.ts`, `pbconfig.ts`, `static/icon.png`.

MangaStream uses the **abstract-field** style, not Madara's params-object DI. The base is
`abstract class MangaStreamGeneric implements ExtensionImpl<typeof basePbConfig>` with
`abstract domain`, `abstract name`, `abstract contentRating`, a `directoryPath` defaulting to
`"manga"`, and a `configureSections()` hook (a no-op on the base) called during setup.

`src/<Name>/main.ts`:

```ts
/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { ContentRating } from "@paperback/types";
import { type BasicAcceptedElems, type CheerioAPI } from "cheerio";
import { type AnyNode } from "domhandler";

import { MangaStreamGeneric } from "../generic/main";
import pbconfig from "./pbconfig";

const DOMAIN_NAME = "https://rokaricomics.com";

class RokariComicsExt extends MangaStreamGeneric {
  name: string = pbconfig.name;
  domain: string = DOMAIN_NAME;
  contentRating: ContentRating = pbconfig.contentRating;

  override directoryPath: string = "comics";

  override configureSections() {
    this.latestUpdatesSection.selectorFunc = ($: CheerioAPI) =>
      $("div.bsx", $("h2:contains(Latest Update)").parent().next());
  }
}

export const RokariComics = new RokariComicsExt();
```

Note the class-name suffix here is `Ext`, not `Extension` — match the neighbours in that repo. The
exported const must equal the directory name.

`src/<Name>/pbconfig.ts` — mutate the shared base:

```ts
/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { basePbConfig, customVersion } from "../generic/config";

let pbConfig = basePbConfig;

pbConfig.name = "RokariComics";
pbConfig.description = "Extension that pulls content from rokaricomics.com.";
pbConfig.version = customVersion({ increasePrerelease: 1 });

export default pbConfig;
```

Versioning inverts the per-source rule: `BASE_VERSION` lives in `generic/config.ts`. Add
`customVersion({ increasePrerelease: N })` only when this site needs a bump ahead of the base;
otherwise omit `version` and inherit. Set `contentRating` here too when the site is not `EVERYONE`.

## Per-site customisation

Prefer, in order: a field override (`directoryPath`), then `configureSections()` selector
functions, then — only if neither reaches it — a narrowly scoped `parsers.ts`. `Thunderscans` is
the worked example: it overrides `directoryPath` and replaces two selector functions on the latest
section, and nothing else.

## What to salvage from the existing sources

Site-specific facts only:

- **RokariComics** — the vendored `generic/` was forked from an older base and has since drifted;
  diff it against upstream to recover only the genuinely site-specific selectors, then discard it.
  The top-level `settings.ts` and `RokariComicsSettings extends MangaStreamSettings` disappear
  entirely; base settings come from `generic/forms.ts`.
- **KingOfShojo** — the fan-out in `buildFeaturedItems` **must not be carried over.** It exists
  because that listing has no adult signal; check whether the base's own discover path already
  derives a content rating, and if it genuinely cannot, raise it before writing per-card fetches.
  A featured carousel that fetches details per card is the single most-rewritten pattern in the
  merge history.
- **KingOfShojo is an adult source — declare it, don't gate it.** Set its `contentRating` to
  `ContentRating.ADULT` and ship **no "show adult content" toggle**. The 0.9/test source has
  already been changed this way: the `show_adult` `ToggleRow`, its `SHOW_ADULT_KEY` state key,
  `getShowAdultContent()`, `handleShowAdultChange()`, the `adultGenreSlugs()` helper that injected
  excluded genres into every browse query, and the `showAdult` parameter on `parsePopularSeries`
  are all gone. Do not reintroduce any of it. Per-title ratings are still derived from the title's
  own genres — the source-level `ADULT` is a presence flag, not a floor, so a non-adult title on an
  adult source still resolves to its own rating.
- **KingOfShojo — drop the `wsrv.nl` image proxy entirely.** The current source rewrites every
  reader page through a third-party resizer
  (`https://wsrv.nl/?w=${width}&q=${quality}&we&default=ssl:…&url=ssl:…`) behind a three-way
  "Image loading" setting (Data saver / Higher quality / Original). None of it goes to the themed
  source: it routes readers' traffic through a service the extension does not control, it silently
  degrades image quality by default, and it duplicates a concern the base already owns. Serve the
  site's own image URLs, and drop the `image_mode` setting and its `proxyImage` helper with it. If
  the pages really are too heavy to load directly, that is a conversation with the base
  maintainers, not a per-site rewrite.
- Both — carry over `contentRating`, `language`, the icon, and any confirmed non-default
  `directoryPath` or section selectors.

## Definition of done

1. `src/<Name>/{main.ts,pbconfig.ts,static/icon.png}` and nothing else, unless a documented
   `parsers.ts` override is genuinely required. No vendored `generic/`.
2. SPDX + copyright header on every `.ts` file.
3. `src/tests/<Name>.ts` generated with `npx paperback-cli test --generate <Name>` and containing
   **only** `registerDefaultTests(suite, <Name>, sourceInfo)` — three arguments, no options object,
   no custom `suite.test(...)` cases.
4. Root README source list updated.
5. `npm run conformance` passes (`tsc` + `oxlint --type-aware --deny-warnings` + `oxfmt --check`).
   Format with `oxfmt`, never Prettier.
6. `npm test` passes.
7. Verified on device with `npm run dev`: discover sections, search, details, chapter list, reader,
   and the Cloudflare challenge path if the site is behind one.

## Do not

- Vendor, fork, or edit a local copy of `generic/`. Base changes are separate PRs against the base.
- Copy the existing bespoke `network.ts` / `models.ts` / `parsers.ts` / `forms.ts`.
- Add a per-site rate limiter or interceptor; the base owns both.
- Port `.slice(0, N)` caps or per-item detail fetches into the new source.
- Route images through a third-party proxy such as `wsrv.nl`.
- Add a "show adult content" toggle to KingOfShojo, or gate its catalogue behind one.
