# Contributing

Node 22+, no dependencies, ES modules, no build step. Pure logic in `lib/`, I/O in `src/`, UI in `ui/`.

The repo is a marketplace with two independent plugins, each with its own version:

| Plugin | Code | Changelog | Tests |
|---|---|---|---|
| `release-sharer` | `plugins/release-sharer/com.github.copilot/extensions/release-sharer/` | `CHANGELOG.md` | `test/` (all `*.test.mjs`, shared folder) |
| `activity-sharer` | `plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/` | `plugins/activity-sharer/CHANGELOG.md` | `test/activity-*.test.mjs` (fixture: `test/fixtures/activity.response.json`, made-up data) |

```
npm run ci             # manifest checks for every plugin + tests (must pass)
npm run dev            # Release Sharer UI in a browser with mocked GitHub (--error=gh_missing etc.)
npm run smoke          # local install test of every plugin (needs the copilot CLI)
npm run spike:activity # Activity Sharer data spike, run on your computer (needs gh; see docs/TESTING.md)
```

`scripts/check-manifests.mjs` loops over every plugin in `.github/plugin/marketplace.json`, so a new plugin needs only its marketplace entry and the same folder layout.

Conventional Commits: `feat(email): ...`, `fix(#42): ...`. Open an issue before larger changes.

## Release checklist

Per plugin, independently (touching one plugin never bumps the other):

1. Bump its version in `plugin.json`, its `marketplace.json` entry, `EXT/package.json` and the top heading of its changelog (see the table). `marketplace.json` `metadata.version` changes only when the plugin list changes.
2. Update the changelog.
3. `npm run ci && npm run smoke`.
4. Bump so installed copies see an update: users only get a new version when the version number changes.
5. Release Sharer: tag `vX.Y.Z` and push; `release.yml` publishes the release from `CHANGELOG.md`. Activity Sharer has no tag trigger yet (it would be `activity-sharer-v*`, added when a GitHub Release is wanted).

Repo settings: require CI on `main`, enable private vulnerability reporting.
