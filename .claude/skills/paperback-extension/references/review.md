# Self-review

Read the diff against each line below before calling a source done or opening a PR.
`scripts/review-source.sh <Name>` prints the bold lines as a checklist. A line you cannot
answer from the code or a live response is unverified: say so.

## Request cost

- **Each Discover section makes one request.** No `Promise.all` over cards for details; drop
  the field or widen the query.
- **No fan-out on a count you did not verify.** A page count and an item count look alike.
- **Page lists come from a total and a template**, not a next-page walk.

## Matching merged code

- **Each feature follows the newest merged example.** `node scripts/upstream-usage.mjs <Name>`
  lists who does the same thing; read the top one before keeping a different shape.
- **Names follow the merged vocabulary** (`fetchJSON`, `parseMangaDetails`, `DOMAIN`,
  `SORT_OPTIONS`) where the meaning is the same.
- **If the source exists upstream, the diff is against upstream's copy**
  (`git diff upstream/0.9/stable HEAD -- src/<Name>`), and a maintainer change there is kept.

## Ids

- **Ids are sanitised with SAFE_ID_REGEX at every place they are made**, with one expression.
- **Filter-option ids and details-page tag ids come from the same function.**
- **chapterId is the site's id**, never a count or position.
- **Ids carry what a later call needs**; nothing rides in `additionalInfo`.

## Filters and defaults

- **Every exposed filter reaches the request**, in the site's casing, exclusions included.
- **A per-search pick replaces the stored default** rather than intersecting with it.
- **Defaults hide nothing the reader did not ask to hide** (content types, ratings).
- **A sort carried by a chip does not override the sort picker.**

## Pagination

- **hasMore comes from the unfiltered page**, and an empty filtered page does not loop.
- **Finite lists return no next page.**

## Failure paths

- **No blanket catch; every request-path catch rethrows CloudflareError.**
- **No second Cloudflare check beside interceptResponse.**
- **Locked, empty and malformed readers throw a useful error.**

## Simplicity

- **Nothing exported is unused**; grep each new export for a consumer.
- **No single-use constant, wrapper or mapper** outside its call site.
- **No guard for a state that cannot happen**, and no `?? x` on a value that cannot be nullish.
- **Comments explain why**; none narrate.

## Shipping

- **Version bumped, test file is the generated baseline, README lists the source.**
- **Tests ran under Node 24 and check-tests.mjs passed**, or the report says which failure is
  the site or the network.
- **Anything only the app can show is listed as unverified** (Discover layout, settings,
  reader rendering, Cloudflare flow).

## Before claiming a finding

Verify it against the code: state the input that breaks it, and for a deletion confirm nothing
references it and `tsc` still passes. Audits of sources here have proposed removing type guards
the compiler requires and a tuple "simplification" that does not typecheck.
