# Release

## The gate

```bash
npm run conformance      # tsc, then oxlint --type-aware --deny-warnings, then oxfmt --check
```

It is also the husky pre-push hook, so a push fails on anything it catches. Node 24, and
`npm install` after cloning.

Two things that bite in this repo:

- **`npm run format` is repo-wide.** It reformats `src/` files you never touched and churns
  the diff. Use `npx oxfmt src/<Source>` instead.
- **oxfmt formats Markdown too** — `CLAUDE.md`, `AGENTS.md`, `handoff/*.md` and everything
  under `.claude/`. Run `npx oxfmt <file>` after editing any of them, or the pre-push hook
  rejects the push.

Never reach for Prettier. Its import sorting and wrapping differ from oxfmt and fail
`format:check`.

## Tests

`src/tests/<Name>.ts` contains nothing but `registerDefaultTests(suite, <Source>, sourceInfo)`
— three arguments, no fourth options object, no custom `suite.test(...)` cases, no seeded
inputs. Generate it with `npx paperback-cli test --generate <Name>` and ship it as generated.

`npm run test` hits the live site, so it cannot run in a sandbox without network access to the
source. Discover sections and settings forms are verified by hand in the app, not with extra
test cases.

## On-device check

```bash
npm run dev
```

Phone and computer on the same network, add the printed `http://<lan-ip>:8080/` as a repo,
reload to reinstall. No version bump needed for a reload.

Paperback treats _any_ version-string difference between two same-name extensions as an
update — including a downgrade — so be deliberate about the published `alpha.N`.

This is where a source actually meets its site. A green conformance run proves the code
compiles and is formatted; it proves nothing about the live contract.

## Versioning

`1.0.0-alpha.N`, bumped on **every** change that ships. A new source starts at `alpha.1`; a
revived source bumps from its old version rather than resetting. The bump is a PR-template
requirement, not a preference.

## README

A new source, a removal, or a branding or domain change means updating the root README's
Sources list. Maintainers block on a missing entry.

## Commits

Conventional Commits, scope is the source name, type is the highest semver impact in the
change (`feat`/`refactor` > `fix` > `chore`). Branch names follow Conventional Branch 1.0.0.

Commits here are authored by **Popmango Extensions** and **unsigned**. Do not name or link
third parties, tools, agents or sessions in code, commit messages, pull request bodies or
documentation.

> `CLAUDE.md` §9 carries an `Assisted-by:` trailer rule inherited from upstream policy. It
> conflicts with the line above, and the line above wins in this repository. Raise it rather
> than resolving it silently in either direction.

## Branches

Work lands on `0.9/test`. `0.9/stable` carries what has settled. A source going to
`inkdex/general-extensions` goes out on its own `feature/<source>` branch, where it restarts
at `1.0.0-alpha.1`.
