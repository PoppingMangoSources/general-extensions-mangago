# Popmango Paperback sources: wiki

Per-source and operational knowledge. Rules for writing sources are in the root `AGENTS.md` /
`CLAUDE.md` and the paperback-extension skill (`references/standards.md`, `references/platform.md`);
this wiki's own rules are in [AGENTS.md](AGENTS.md).

## Start here

- Changing a source: its page under `sources/`, then the skill.
- Adding a check: [operations/source-checks.md](operations/source-checks.md).
- Bringing inkdex changes in: [operations/upstream-sync.md](operations/upstream-sync.md).

## sources

- [Chikari](sources/Chikari.md): shared comic/novel listings, separate reader routes and stable ids.
- [Toonkotsu](sources/Toonkotsu.md): reader keys, WebView session, AES-CTR in TypeScript.
- [YaoiMe](sources/YaoiMe.md): advanced search metadata carries `undefined` values (device crash risk).

## operations

- [source-checks](operations/source-checks.md): the offline checker, its calibration, and the backlog.
- [upstream-sync](operations/upstream-sync.md): keeping our `0.9/stable` level with inkdex.

## history

- [log](log.md)
