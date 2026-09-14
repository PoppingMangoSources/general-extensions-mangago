# `@paperback/types` surface

The types are alpha and shift. Everything here was checked against the installed
`node_modules/@paperback/types` — re-check before relying on it, and prefer reading the `.d.ts`
over trusting this file.

## Shapes worth knowing before you design around them

### `MangaInfo` has no language field

`SourceManga` is `{ mangaId, mangaInfo }` plus read-only counts the app owns. `MangaInfo`
carries `thumbnailUrl`, `synopsis`, `primaryTitle`, `secondaryTitles`, `contentRating`,
`contentType`, `status`, `artist`, `author`, `bannerUrl`, `rating`, `tagGroups`,
`artworkUrls`, `additionalInfo` and `shareUrl`.

There is no slot for a language. `Chapter.langCode` is per-chapter, so if the site carries
language on the _title_ rather than the chapter, the value has to reach `getChapters`
somehow — and `additionalInfo` is the only carrier. That is a documented tension with §6's
"no side-channels" rule, not a licence: bind the key to one exported constant so the writer
and the reader cannot drift, and say why in a comment.

### `ExtensionInfo.language` is metadata

Optional, and documented as "the language of the extension's source". Use a lowercase IETF
tag, or `multi` for a multi-language source. It does not filter anything — a multi-language
source still needs a real Languages setting.

### `featuredCarouselItem.infoItems` is a tuple

Typed `[InfoItem] | [InfoItem, InfoItem]` — **at most two**, and an array does not satisfy it.
`.slice(0, 2)` widens to `InfoItem[]` and fails to typecheck. Build the tuple explicitly.
Three separate audits have proposed "simplifying" this; all three were wrong.

### A mapper returning `T | undefined` needs its filter

`.filter((item): item is T => item !== undefined)` after a `.map()` over such a mapper is
required by the compiler even when only one branch of the mapper can actually return
`undefined`. It is not dead code. Narrowing by the literal argument would need overloads.

## Forms

- `SelectRow` takes **`items` + `layout`**. The `options` form is deprecated in the type
  definition — some merged sources still use it; do not copy that.
- `layout` is `"flow"` (chips) or `"list"`. A long option list as a chip flow is unusable —
  use `"list"` past a couple of dozen entries.
- `maxItemCount` reflects real selection semantics. `1` for single-select, not the option count.
- Every row callback is `Application.Selector(this as <ConcreteForm>, "handleX")`, and the
  handler is a real `async` method on that class. The self-cast is required.
- Tri-state genre filters use `TriStateSelectRow` with `allowExclusion` / `allowEmptySelection`
  and a `Record<string, "included" | "excluded">` value.
- Share the persist tail as a free function taking the form
  (`saveSetting(form, key, value)`), never a base class — §2 of the guide names this example.

## `Application`

- `setState(value, key)` — **value first**. `getState(key)` takes the key alone. Reversing them
  writes to the wrong slot silently.
- `scheduleRequest({ url, method, headers, body })` returns `[response, buffer]`. Everything
  goes through it; a raw fetch bypasses the interceptors, the limiter and the cookie store.
- `arrayBufferToUTF8String(buffer)` to decode — not `TextDecoder`.
- `decodeHTMLEntities(...)` on every scraped display string, at the parser boundary.
- `invalidateDiscoverSections()` from any settings handler that changes discover output.
- `getDefaultUserAgent()` returns a bare WebView UA, which is not the UA a Cloudflare challenge
  webview solves with. See §4 on presenting one identity.

## Status checks

Merged sources compare `response.status !== 200` exactly. A `>= 200 && < 300` range check
appears in several sources in this repo but in none of the merged ones — match the merged
convention for anything headed to a pull request.

On a GraphQL endpoint this has a cost worth knowing: a schema error arrives as a non-200 with
the reason in the body, so a status check that throws before parsing discards the only useful
diagnostic. Parse first when the body carries `errors`.

## Capabilities

Each `SourceIntents` value in `pbconfig.ts` obliges the class to implement its methods, and
`ExtensionImpl<typeof Config>` makes the compiler enforce it. The table in `CLAUDE.md` §7 maps
capability to required and optional methods.
