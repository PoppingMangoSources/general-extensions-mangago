# Recon

Establish the live contract before writing code. `CLAUDE.md` §1 states the rule; this is the
method.

Work through five targets. For each, write down the exact URL, the selector or JSON path for
every field, and the pagination signal, before any of it reaches a file.

## 1. Discover

What the home page actually offers, and under what names. Each row you intend to ship needs
its own endpoint confirmed — a row you cannot fetch independently is a row you cannot
paginate.

Record: the endpoint per section, the page-size parameter, and whether the listing payload
already carries the fields your cards need. That last one decides whether you can build the
section in one request, and §3 of the guide forbids the alternative.

## 2. Search and filters

- The search URL shape, and what it does with an empty term.
- Every facet the site exposes, with **the site's own casing and spelling** for values. Copy a
  real filtered request off the site and mirror it. A case mismatch is silently ignored
  server-side, so the filter looks wired up and does nothing.
- Whether included _and_ excluded values are supported. Use server-side filtering when it
  exists; client-side crawling is a fallback, not a default.
- The pagination contract: page number, offset, or cursor, and the field that says there is
  more.

## 3. Title view

Title, cover, synopsis, status, authors, tags. Note which of these the _listing_ payload
already has — anything present there must not be re-fetched per card.

For tags, confirm the id form the filter expects, and that a tag id from the details page is
the same string. One derivation function per vocabulary; a tag that does not round-trip into
search is a dead link.

## 4. Chapter list

- Where it comes from: inline markup, an embedded JSON blob, or a separate endpoint.
- **The real chapter identifier.** Not the index, not the count. Confirm the site's own
  numbering is not contiguous before assuming a position works as an id.
- Pagination: the total, and whether it is a page count or an item count. These look alike in
  a response and behave very differently when you fan out on them.
- The language, if the site is multi-language: on the chapter, or on the title?

## 5. Chapter pages

The image list, its lazy-load attributes, any referer or `accept` requirement, and whether a
total plus a URL template exists. If it does, generate the list — do not walk it.

## Recording what you could not verify

The sandbox cannot reach most source sites. When a field or endpoint could not be confirmed
live, say so explicitly rather than treating a reference implementation's selection as proof.

Two failure shapes worth naming:

- **Absence of selection is not absence of field.** Another client not asking for a field does
  not mean the schema lacks it.
- **A wrong field name is not a silent degradation.** On a strict API it is a validation error
  that takes down the whole capability. If you cannot confirm one, leave the working code
  alone and flag it for an in-app check.
