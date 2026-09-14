---
name: paperback-extension
description: Create, refactor or review a Paperback 0.9 source (extension) in this repo. Use when adding a comic/manga/novel site as a source, scaffolding a new extension, fixing or extending an existing one, preparing a source for an inkdex pull request, or reviewing a source diff.
---

# Building Paperback 0.9 sources

A source is a TypeScript class implementing `ExtensionImpl<typeof Config>` from
`@paperback/types`, exported as an instance from `main.ts`. `pbconfig.ts` declares which
capabilities it provides, and the compiler holds the class to them.

**`CLAUDE.md` at the repo root is the authoritative guide** — ten numbered sections covering
file organization, discover/search/pagination, Cloudflare, caching, ids, `pbconfig`, theme
placement and commits. It wins over anything here. This skill is the order to do things in,
plus the SDK facts and review patterns that sit underneath those rules.

Work in four phases. Each depends on facts the previous one established.

## Phase 0 — Does this source belong here?

Before writing anything, check the site against the recognized generic themes. A Madara site
belongs in `inkdex/madara-extensions`; a MangaStream site in `inkdex/mangastream-extensions`.
A bespoke reimplementation of a themed site in this repo is a rejection, not a review comment.
See `CLAUDE.md` §8, and `handoff/` for briefs on sources already identified as misplaced.

## Phase 1 — Recon

Never write a selector or a field name from memory, and never trust a reference
implementation's field list. Read `references/recon.md` and confirm, against real responses:
the endpoint for each capability, the pagination signal, the id that identifies a chapter,
and the exact spelling and casing of every filter value.

The cost of skipping this is not a bug you find in review — it is a source that compiles,
passes the gate, and returns nothing.

### Porting from another app's implementation

Most sources here have a working counterpart elsewhere. Two rules:

- **Port the whole capability set.** Every discover section, filter, setting and sort. A
  capability dropped in the port is one the reader loses, and nobody notices until they
  go looking for it.
- **The reference tells you the endpoints; it does not tell you the schema.** Field
  selections differ between implementations, and a field one client does not select may
  still exist. Confirm against a live response before copying or removing one.

## Phase 2 — Build

Follow the canonical file set in `CLAUDE.md` §2. `references/api.md` carries the
`@paperback/types` surface that the guide assumes but does not spell out — the shapes, the
current form API, and the places where the types constrain what looks like a free choice.

Order that avoids rework: `models.ts` (types and constants) → `network.ts` (interceptor and
fetch helpers) → `parsers.ts` (mappers) → `main.ts` (handlers) → `forms/` → `pbconfig.ts`.

## Phase 3 — Self-review

Read `references/review.md` and walk it before calling the work done. It is the checklist
distilled from what maintainers actually send back: request-cost problems, id round-trips,
filters that silently match nothing, and defaults that hide content the user asked for.

Reviewing someone else's diff is the same checklist, plus `CLAUDE.md` §9's review list.

## Phase 4 — Ship

`references/release.md` has the gate, the versioning rule and the commit rules. Short version:
`npm run conformance` must pass (it is also the pre-push hook), `src/tests/<Name>.ts` contains
nothing but `registerDefaultTests`, and the source version bumps on every change.

## What this environment cannot do

Most source sites are unreachable from the sandbox's egress proxy, and `npm run test` hits
the live site. A green `conformance` run says the code compiles, lints and is formatted — it
says nothing about whether the source works. Anything that depends on a live response has to
be confirmed in the app, on a device, via `npm run dev`.

When a claim cannot be checked here, say so and name what would settle it. Do not edit
working code on an inference you could not test.
