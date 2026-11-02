# Review evidence

Verbatim maintainer comments from merged `inkdex/general-extensions` pull requests, read from
the GitHub API on 2026-11-02, plus maintainer cleanup commits on `upstream/0.9/stable`. Each
rule in `standards.md` that cites a number comes from here. Add a row when a new review lands,
in the same commit as the fix, and change the rule if the comment contradicts it.

## Review comments

| PR  | Reviewer | File                          | Comment                                                                                                                                                    |
| --- | -------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 244 | niclimcy | AllManga/main.ts              | "having this here breaks repo convention and is repeated with what you have in api.ts. main.ts should be self contained and only have the extension class" |
| 238 | niclimcy | AllManga/network.ts           | "Deduplicate with API_URL"                                                                                                                                 |
| 238 | niclimcy | AllManga/models.ts, forms.ts  | "remove comments like this"                                                                                                                                |
| 238 | niclimcy | AllManga/main.ts              | "why is this here? move to models.ts"                                                                                                                      |
| 238 | niclimcy | AllManga/network.ts           | "why have custom cloudflare error handling here when it will already be handled in interceptResponse"                                                      |
| 238 | niclimcy | AllManga/network.ts           | "Please refer to how existing extensions like Anilist build their graphql query, this seems like a wrapper function"                                       |
| 238 | niclimcy | tests/AllManga.ts             | "why? no need to define custom manga for test suite"                                                                                                       |
| 238 | niclimcy | AllManga/parsers.ts           | "unnecessary comment"; "why make it a constant when it will only be used once..."                                                                          |
| 238 | niclimcy | (approval)                    | removed the GraphQL page query: "it is broken and will not work even if you fix it as it is encrypted"                                                     |
| 214 | niclimcy | MangaDemon/main.ts            | "app does not accept id values outside of those in the regex"                                                                                              |
| 214 | celarye  | MangaDemon/main.ts            | "advanced search does have pagination, should be used for all search queries"                                                                              |
| 214 | niclimcy | MangaDemon/main.ts            | "You can't search by title and filter at the same time"                                                                                                    |
| 185 | niclimcy | MangaDot/api.ts               | "Why did you make this an instance variable? Functions within this class may not be called in order and may cause a race"                                  |
| 185 | niclimcy | MangaDot/parser.ts            | "Why use filter here? … just do `return chapterAPI.map...`"                                                                                                |
| 185 | niclimcy | MangaDot/forms/search.ts      | "ArtistFilter but still mentions author in some places"                                                                                                    |
| 185 | niclimcy | MangaDot/api.ts               | "Are you gonna filter by artists too? I do not see it being added as a query here"                                                                         |
| 156 | niclimcy | PunkRecords/utils.ts          | "You have multiple DOMAIN listed across different files, move them all to one place (in models.ts)"                                                        |
| 156 | niclimcy | PunkRecords/utils.ts, main.ts | "Why are you making a wrapper of this function"; "wrapper of a wrapper function..."                                                                        |
| 156 | niclimcy | PunkRecords/parsers.ts        | "why not make life easier and use cheerio"                                                                                                                 |
| 156 | niclimcy | PunkRecords/forms.ts          | "this pattern is using a `FormState` class is no longer preferred"                                                                                         |
| 156 | niclimcy | PunkRecords/models.ts         | "use URL class from paperback/types to build paths … inlined for code readability"                                                                         |
| 156 | niclimcy | PunkRecords/models.ts         | "No idea why are you re-exporting paperback types here, you should be directly using the paperback types"                                                  |
| 156 | niclimcy | PunkRecords/main.ts           | "its so odd passing the entire extension class into the form, you can move that get and set function directly within the form class"                       |
| 152 | niclimcy | WeebCentral/forms.ts          | "`const metadata = query.metadata ?? { genres: [], … }` then use `metadata.genres`"                                                                        |
| 152 | niclimcy | WeebCentral/helpers.ts        | "Why rethrow error as string? Unless it is an app issue you can just skip the try catch here"                                                              |
| 142 | niclimcy | Comix/forms/search.ts         | "Wrong section for that row?"                                                                                                                              |
| 142 | niclimcy | Comix/main.ts                 | "duplicate line?"; "sortingOption is never undefined?"                                                                                                     |
| 271 | niclimcy | (conversation)                | "Can you run format first and force push over?" (the author's newer oxfmt had reformatted another file)                                                    |

## Maintainer cleanup commits

| Commit                | What it removed or changed                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `e424b7c` FlameComics | `FlameApi`/`FlameParser` classes, `utils/filter.ts`, `utils/pickers.ts`, dividers and JSDoc: −1215/+628                                                                              |
| `225a974` MangaFire   | refactor and clean-up: −816/+526                                                                                                                                                     |
| `ad31e79` Comix       | clean-up and refactor: −1416/+736                                                                                                                                                    |
| `173bccd` Mangago     | next-page reader walk and cache modules deleted for a template + `total_pages` page list; genre tag ids matched to the filter; deprecated bypass hook removed; carries `Assisted-by` |
| `c064615` AllManga    | GraphQL page query removed as broken                                                                                                                                                 |
| `75274b7` all         | moved every source to `cloudflareBypassCompleted`                                                                                                                                    |
| `3cc4d2b` all         | replaced `decodeHTML` with `Application.decodeHTMLEntities`                                                                                                                          |
| HiveToons merge       | featured carousel's slice-and-fetch-details replaced by the listing payload: 9 requests to 1                                                                                         |

## Facts verified in code (not from a review)

- The published `paperback-cli test` (toolchain 1.0.0-alpha.92) exits 0 when tests fail and
  skips a source with no test file (`dist/src/commands/test/index.mjs`). The inkdex toolchain
  fork adds a non-zero exit (`555872c`), unreleased. `scripts/check-tests.mjs` covers the gap.
- Tests need Node 24: under Node 22 a source fails to load with `Float16Array is not defined`
  and the run still reports 0 failures.
- Merged code disagrees with three written rules, which are notes in the checker: `SelectRow`
  `options` (11 merged sources, MangaFire in October 2026), flag emoji (MangaFire), and
  `function` declarations in parsers (Mangago, AllManga).
