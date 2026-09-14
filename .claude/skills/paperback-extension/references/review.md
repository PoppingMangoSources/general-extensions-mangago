# Self-review

Walk this before calling a source done, and before opening a pull request. It is ordered by
what actually comes back from review. `CLAUDE.md` §9 has the maintainer-facing checklist;
this is the author-facing one.

## Request cost

- **Count the requests a discover section makes.** One per section. A `Promise.all` over
  listing cards is the single most-deleted pattern in this repo's history.
- A field missing from the listing card is not a reason to fan out. Widen the query if the API
  is field-selectable, otherwise drop the field.
- Look for unbounded fan-out on a count you did not verify. `Promise.all` over
  `pageCount - 1` is fine when the field means pages and the page size is large; it is
  hundreds of concurrent requests when the field turns out to be an item count.
- A walk that fetches page N to learn about page N+1 is N sequential requests. If the payload
  carries a total and the URLs follow a template, generate the list instead.

## Ids

- Sanitize at **every** id-producing call site, with the same expression. Two derivations of
  the same id diverge: one sanitized and one not, or two different fallbacks, and a discover
  card no longer matches its chapter-list entry.
- Sanitize the filter-option ids and the details-page tag ids with the same function, or
  tapping a tag returns nothing.
- Never derive a `chapterId` from a count or a list position when the site exposes a real one.
- Ids are self-sufficient: everything needed to re-fetch lives in the id, not in
  `additionalInfo`.

## Filters and defaults

- **Does a per-search filter narrow or replace the stored default?** Intersecting them can
  produce an empty set, which sends an unfiltered request and then drops every row locally —
  a blank screen with no error. Per-search picks replace.
- Does a default hide content nobody asked to hide? Check the default content-type and
  content-rating sets against what the site actually offers. A default covering three of
  seven types silently hides four categories on a fresh install.
- Is every exposed filter wired to a request parameter, in the site's own casing?
- Does a chip or shortcut that carries a sort override the live sort picker? If the chip's
  metadata wins on every later call, the picker is inert.

## Pagination

- `hasMore` derives from the **unfiltered** count.
- A handler that filters client-side and comes back empty must not advertise another page, or
  the app requests page after page forever.
- Finite taxonomy sections return no next-page metadata.

## Failure paths

- No blanket `catch {}`. Every catch on a request, parse or reader path re-throws
  `CloudflareError`.
- No `catch (e) { throw new Error(String(e)) }`.
- No second Cloudflare check on top of what `interceptResponse` already does.
- Errors that must reach the user are thrown, with the original as `cause`.

## Dead and duplicated code

- Grep every exported symbol for a consumer before shipping it.
- A guard already enforced upstream is dead. So is a `?? fallback` on a value that cannot be
  nullish at that point, and a ternary guarding an empty array construction.
- Two functions differing only by a token or a mapper are one parameterized function.
- A mapper with exactly one call site belongs at that call site; a helper used from several
  belongs in `parsers.ts` with a purpose name.

## Naming

- Does the name describe what the value holds? A list called `includedGenres` that also
  carries format ids does not.
- Does a state-key string match its constant? Renaming one resets that setting for existing
  users — worth doing before release, not after.
- Do two files call the same concept different things?
- Locals that shadow globals (`number`, `data` beside `JSON`) get renamed.

## Before you claim a finding

Verify it against the code. Three separate audits of one source in this repo proposed removing
type guards the compiler requires, and two proposed a tuple "simplification" that does not
typecheck. If you assert a bug, state the input that triggers it; if you propose a deletion,
confirm nothing references it and that `tsc` still passes.
