# Self-review

Read the diff against each line before calling a source done or opening a PR.
`scripts/review-source.sh <Name>` prints the bold lines as a checklist. A line you cannot answer
from the code or a live response is unverified: say so.

## Request cost

- **Each Discover section makes one request.** No `Promise.all` over cards for details.
- **No fan-out on a count you did not verify.**
- **Page lists come from a total and a template**, not a next-page walk.

## Matching merged code

- **Each feature follows the newest merged example** (`node scripts/upstream-usage.mjs <Name>`).
- **Names follow the merged vocabulary** (`fetchJSON`, `parseMangaDetails`, `DOMAIN`, `SECTIONS`).
- **If the source exists upstream, the diff is against upstream's copy** and maintainer changes
  are kept.
- **No class that only holds static methods, no Api class, no base class for helpers.**

## Device-only failures

- **No `undefined` value in any Metadata object** (paging, form results, chip queries).
- **Object request bodies are JSON.stringify-ed.**
- **No timers; WebCrypto use is limited to SHA, HMAC, AES-GCM/CBC, HKDF/PBKDF2.**
- **Every id field is sanitised** (manga, chapter, tags, section ids, form rows).
- **Rating is 0..1, volume is set, titles carry no leading chapter number.**

- **Ordinary subtitles contain at most two facts, latest chapter first when present.**
- **Mixed catalogs prefer chapter plus type; known totals use `N Chs` (Swarm: `N Chapters | Type`).**
- **Hero icons have compact numbers without repeated metric labels.**
- **Every returned cover is an absolute HTTP(S) URL, including coverless site cards.**

## Ids

- **Ids are the shortest stable site key**, never a full URL, and carry what later calls need.
- **Filter-option ids and details-page tag ids come from the same function.**
- **chapterId is the site's id**, never a count or position.

## Filters, defaults and paging

- **Every exposed filter reaches the request**, in the site's casing, exclusions included.
- **A per-search pick replaces the stored default** rather than intersecting with it.
- **Defaults hide nothing the reader did not ask to hide.**
- **An empty search returns results; hasMore comes from the unfiltered page.**

## Failure paths

- **No blanket catch; every request-path catch rethrows CloudflareError.**
- **No second Cloudflare check beside interceptResponse.**
- **Locked, empty and malformed readers throw a useful error; the newest chapter opens.**

## Simplicity

- **Nothing exported is unused; no single-use constant, wrapper or mapper outside its call site.**
- **No guard for a state that cannot happen, no cast without a reason.**
- **Comments explain why; none narrate.**

## Shipping

- **Version bumped, test file is the generated baseline, README lists the source.**
- **Live tests ran under Node 24 and check-tests.mjs passed**, or the report names the site or
  network failure.
- **The source's wiki page records any trap found.**
- **Anything only the app can show is listed as unverified.**

## Before claiming a finding

Verify it against the code: state the input that breaks it, and for a deletion confirm nothing
references it and `tsc` still passes. niclim's review on #192 is the model: he traced the value
through three files and compared with the old implementation before calling it a bug.
