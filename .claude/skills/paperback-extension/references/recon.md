# Recon

Establish the live contract before writing code. Write down, for each target, the exact URL, the
selector or JSON path of every field, and the pagination signal, before any of it reaches a file.
Keep the findings in the source's wiki page (`docs/sources/<Name>.md`).

## Tools

- `curl -sS -D - <url>` for headers, status and redirects; send the `accept` the site's own client
  sends. Through this sandbox some sites answer and some do not.
- The pre-installed Chromium (`require('playwright')`, `chromium.launch()`) for client-rendered
  sites: load the page, record every XHR/fetch with its request body and response, and copy a real
  filtered request. A Cloudflare challenge page is a finding, not a dead end: note it and stop.
- The site's own JavaScript bundle names the API, its parameters and their exact casing.
- Reference clients (keiyoushi, Aidoku, Mana, Paperback 0.8) tell you endpoints, not the schema.
  Porting one is the last option (duck, Seyden): build from the site's own requests.

## 1. Discover

What the home page offers, under the site's own names, in the site's order. Each row needs its own
endpoint, a page-size parameter, and a listing payload that already carries what its cards show;
otherwise drop the field, never fetch per card.

## 2. Search and filters

- The search URL and what it returns for an empty term (the default test searches `""`).
- Every facet the site exposes, values in the site's casing, and whether exclusions exist. Probe
  each parameter with a value that should change the result; an unchanged result means it is
  ignored.
- The paging contract: page, offset or cursor, and the field that says there is more.

## 3. Title view

Title, cover, synopsis, status, authors, tags, rating (and its scale: the app wants 0..1). Note
what the listing already has. Confirm the tag id form the filter expects and derive both from one
function.

## 4. Chapter list

- Inline markup, embedded JSON, or its own endpoint; complete or paged.
- **The real chapter id**, and the shortest stable manga key that rebuilds every URL (ids are
  stored per chapter; a full URL bloats every library).
- Volumes, decimal numbers, duplicate uploads (groups), dates, locked or paid markers, language.

## 5. Reader

The image list, lazy-load attributes, referer/cookie/`accept` needs, encryption or scrambling, and
whether a total plus a URL template exists. Check which crypto it uses: the device has no AES-CTR,
so that one must be done in TypeScript.

## Recording what you could not verify

When a field or endpoint could not be confirmed live, say so. Absence of a field from another
client's selection is not absence from the schema; a wrong field name on a strict API is an error
that takes the whole capability down. Leave working code alone and flag it for an in-app check.
