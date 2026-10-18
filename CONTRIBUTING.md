# Contributing

Node 22+, no dependencies, ES modules, no build step. Pure logic in `lib/`, I/O in `src/`, UI in `ui/` (all under `plugins/release-sharer/com.github.copilot/extensions/release-sharer/`).

```
npm run ci     # manifest checks + tests (must pass)
npm run dev    # UI in a browser with mocked GitHub (--error=gh_missing etc.)
npm run smoke  # local install test (needs the copilot CLI)
```

Conventional Commits with the scope ID: `feat(F-07): ...`, `fix(#42): ...`. Scope and status live in `.project/release-sharer-ROADMAP.md`.

## Release checklist

1. Bump the version in `plugin.json`, `marketplace.json` (two places), `EXT/package.json` and the top `CHANGELOG.md` heading.
2. Update `CHANGELOG.md` and roadmap statuses.
3. `npm run ci && npm run smoke`.
4. Tag `vX.Y.Z` and push; `release.yml` publishes the release from the changelog.

Repo settings: require CI on `main`, enable private vulnerability reporting.
