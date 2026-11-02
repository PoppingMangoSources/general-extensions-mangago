# Submitting to inkdex

`inkdex/general-extensions` (`0.9/stable`) is to this repository what Aidoku-Community is to
our Aidoku fork: sources mature here on `0.9/test`, then go upstream one per pull request.

## Branches here

- `0.9/test` is where our sources live and what our repository page publishes.
- `0.9/stable` mirrors `inkdex/general-extensions` `0.9/stable` with our README and homepage
  theme. Bring upstream in with `scripts/sync-upstream.sh` (a merge; history is never
  rewritten). Do not develop sources there.
- A submission goes out on its own branch built from upstream, never from `0.9/test`.

## Building the branch

```sh
PATH=/opt/node24/bin:$PATH scripts/pr-branch.sh <Name> -m "feat: Add <Name>" --assisted-by "ClaudeCode:<model>"
PATH=/opt/node24/bin:$PATH scripts/pr-branch.sh <Name> -m "fix(<Name>): <summary>" --assisted-by "ClaudeCode:<model> Codex:<model>" --push
```

`--assisted-by` takes every tool that helped, each `Tool:model`, space-separated; the script
writes one `Assisted-by:` trailer at the end of the message, the format niclim asked for on #192.
Use `--no-ai` only when no agent touched the change.

It creates a worktree on `upstream/0.9/stable`, copies only `src/<Name>/` and
`src/tests/<Name>.ts` from `--from` (default `HEAD`), sets the version (a new source
`1.0.0-alpha.1`; an upstream one upstream's alpha + 1), adds the README entry in alphabetical
order, then runs upstream's own `npm ci` and `conformance`, our source rules, the live tests
through `check-tests.mjs`, and `check-submission.mjs`. The branch is `feature/<name>` for a new
source and `bugfix/<name>` for an upstream one. It commits as Popmango Extensions with the
`Assisted-by` trailer and pushes only with `--push`. It never opens a PR.

`check-submission.mjs` fails if any commit (not only the final diff) touches a file outside the
source, its test and its README line, if a commit is a merge or not a Conventional Commit, or
if the version is wrong.

## Before opening the PR

- Read `review.md` against `git diff upstream/0.9/stable feature/<name>`.
- If the source is on a generic theme, it goes to that theme's repository instead.
- Check the README URL the script inserted.
- Fill in the template (`inkdex/general-extensions/.github/pull_request_template.md`): summary
  in one to three sentences, every box honestly, the AI-assistance box. Say what was exercised
  on a device and what was not. Explain a deliberate departure from a merged pattern (a
  hardcoded genre list because the API has none, as on AllManga #238).
- The person opens the PR. Draft the description for them; do not post it.

## Review rounds

- Each comment gets a change or a reasoned reply. Fix on `0.9/test` first (with a bump there),
  then rebuild or add a commit to the submission branch; push with `--force-with-lease`.
- Fetch the branch first: maintainers push to contributors' branches (niclimcy pushed
  `c064615` onto `feature/allmanga` and rewrote HiveToons in place). Their commit is the fix to
  copy back to `0.9/test`; read it as a review (`evidence.md` lists what each rewrite removed).
- Keep the branch linear: rebase on `upstream/0.9/stable`, never merge it in (#156). A maintainer
  may offer to squash.
- Add each new review comment to `evidence.md`, and its rule to `standards.md` (and to
  `check-sources.mjs` if it can be detected offline) in the same commit as the fix.

## After the merge

The upstream copy wins. Bring it back with `scripts/sync-upstream.sh`, then compare `0.9/test`'s
copy with `git diff upstream/0.9/stable HEAD -- src/<Name>` and take the maintainer's changes
into `0.9/test` before the next fix, so the two do not drift.
