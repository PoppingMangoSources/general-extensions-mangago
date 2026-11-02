# Testing

Keep three kinds of result apart when reporting: offline gates, live tests from this machine,
and the app on a device. Each proves less than the next.

## Offline gates

```sh
npm run conformance               # tsc, oxlint --type-aware --deny-warnings, oxfmt --check
npm run check -- --base origin/0.9/test   # source rules on changed sources, with the version bump
npm run test:scripts              # tests for scripts/
```

- Format one source with `npx oxfmt src/<Name>`; `npm run format` touches every file. oxfmt
  also formats Markdown. Never Prettier.
- `node scripts/check-sources.mjs` alone reports the backlog in every source; fix what you
  touch. `--calibrate --root <inkdex clone>` counts each rule over merged code: a rule that
  fails a recent maintainer-approved source is too broad and becomes a note.

## Live tests

```sh
PATH=/opt/node24/bin:$PATH npm test -- <Name>
node scripts/check-tests.mjs <Name>
```

- Node 24 is required. Under Node 22 a source dies with `Float16Array is not defined`, and the
  run still prints "Failed: 0".
- `paperback-cli test` exits 0 on failure and skips a source with no test file;
  `check-tests.mjs` reads `bundles/tests.json` and fails on both.
- The sandbox reaches some sites (XCOMIC passed six tests on 2026-11-02) and not others. A
  network or Cloudflare failure is unverified, not a pass and not a source bug: name it.
- `scripts/review-source.sh <Name>` runs all of this and stamps the result.

## On a device

```sh
npm run dev       # paperback-cli serve --watch; add http://<lan-ip>:8080/ as a repository
npm run logcat    # stream the app's logs
```

Reload the repository in the app to reinstall; no version bump is needed for that. Paperback
treats any version difference as an update, downgrades included.

Only the app shows: Discover layout and card types, settings rows and their persistence,
Cloudflare challenges and cookies, reader rendering (images, novels, GIFs, descrambling),
chapter grouping and sorting, and tracker behaviour. Report the source version, app build,
title and chapter exercised. Not exercised means unverified.
