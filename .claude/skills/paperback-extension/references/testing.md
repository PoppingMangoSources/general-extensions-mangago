# Testing

Report three kinds of result separately: offline gates, live tests from this machine, and the app
on a device. Each proves less than the next. `platform.md` lists what each one cannot see.

## Offline gates

```sh
npm run conformance                       # tsc, oxlint --type-aware --deny-warnings, oxfmt --check
npm run check -- --base origin/0.9/test   # source rules on changed sources, with the version bump
npm run test:unit                         # test/unit: parsers, decoders, id builders
npm run test:scripts                      # scripts/tests
npm run check:docs                        # AGENTS.md == CLAUDE.md, skill copies identical
```

- Format one source with `npx oxfmt src/<Name>`. oxfmt formats Markdown too. Never Prettier.
- `node scripts/check-sources.mjs` with no names reports the backlog; fix what you touch.
  `--calibrate --root <inkdex clone>` counts each rule over merged code.

## Unit tests (`test/unit/<Name>.test.ts`)

Deterministic tests of code that needs no network: parsers over a small sanitised fixture, id
builders, chapter numbering, decryption against an independent oracle. They run with
`node --import ./scripts/ts-resolve.mjs --test` (Node 24 strips the types; the hook resolves the
bundler-style `./models` imports), and they never ship: `scripts/pr-branch.sh` copies only
`src/<Name>/` and the generated test. Pattern from kodama's repository.

- Assert values against the site's own data or an oracle (Node's `crypto` for AES-CTR), not just
  that something came back. Show the test failing on broken code once before trusting it.
- Keep fixtures small and scrubbed of cookies, tokens and account data.
- A module that touches `Application` at import time cannot be loaded this way; parsers should
  not.

## Live tests

```sh
PATH=/opt/node24/bin:$PATH npm test -- <Name>
npm run test:check -- <Name>
```

- Node 24 is required. Under Node 22 a source dies with `Float16Array is not defined` and the run
  still prints "Failed: 0".
- `paperback-cli test` exits 0 on failure and skips a source without a test file;
  `check-tests.mjs` fails on both.
- The default suite: initialise, sorting options, empty-title search, details of the first
  result, chapters, details of `chapters[0]`. It never checks pages, images, Discover, settings or
  forms, and its request interceptors do not chain.
- **Throwaway deep test**: to see real values, temporarily replace the test file with one that
  calls the methods and logs results, run it, read `bundles/tests.json` (console output is captured
  per test), then restore the generated file. `check-sources.mjs` fails if you forget.
- The sandbox reaches some sites (XCOMIC passed six tests on 2026-11-02). A network or Cloudflare
  failure is unverified, not a pass and not a source bug: name it.
- Novel chapters: dump the `html` and run `xmllint --noout` on it; it is the same parser as the
  reader.

## On a device

```sh
npm run dev                         # serve with --watch; add http://<lan-ip>:8080/ as a repository
npm run logcat -- --ip <phone-ip>   # stream the app's logs
```

Reload the repository in the app to reinstall. The app never installs a lower version, so publish
deliberately. Only the device shows: `Metadata` and id-charset crashes, `0`/`false` bodies,
Discover layout, settings and their persistence, Cloudflare and cookies, WebView flows, reader
rendering (images, GIFs, novels), chapter grouping, versions and sorting, ratings. Report the
source version, app build, title and chapter exercised. Not exercised means unverified.

## Request cost

Count the requests each operation makes (search page, details, chapters, reader, each section).
pirate.vodka budgets about 12 document and 3 image requests for a full default run per source; a
source needing many more is fanning out.
