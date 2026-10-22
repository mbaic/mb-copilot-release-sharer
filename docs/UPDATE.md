# Update Release Sharer and Activity Sharer in the GitHub Copilot app

Steps marked (unverified) were not run in the real app yet; note any difference in `docs/TESTING.md`.

Your installed copy only changes when you update it. Each plugin has its own version and updates only when that version changes: Release Sharer in [CHANGELOG.md](../CHANGELOG.md), Activity Sharer in [its changelog](../plugins/activity-sharer/CHANGELOG.md). Updating one never touches the other. The commands below use `release-sharer`; for Activity Sharer replace the plugin name with `activity-sharer` (marketplace stays `release-sharer`), e.g. `copilot plugin update activity-sharer@release-sharer`.

## 1. See what is installed

```
copilot plugin list
```

Note the `release-sharer` version. Compare with the top heading of [CHANGELOG.md](../CHANGELOG.md).

## 2. Update

In the Copilot app: Customize > Plugins > Marketplaces > refresh `mbaic/mb-copilot-release-sharer`, then update `release-sharer` (unverified UI wording).

Or CLI:

```
copilot plugin marketplace update release-sharer
copilot plugin update release-sharer@release-sharer
```

If your CLI has no `update` command or the version stays the same, reinstall:

```
copilot plugin uninstall release-sharer
copilot plugin marketplace update release-sharer
copilot plugin install release-sharer@release-sharer
```

If the marketplace was added from a local clone, run `git pull` in the clone first, then the commands above.

Manual install (copied folder): replace `~/.copilot/extensions/release-sharer/` (Windows: `%USERPROFILE%\.copilot\extensions\release-sharer\`) with the new `plugins/release-sharer/com.github.copilot/extensions/release-sharer/`. Keep `state.json` there if you want to keep your saved preferences. If you use the start skill without the plugin, also copy `plugins/release-sharer/skills/mb-release-sharer/` to `~/.copilot/skills/`. Same pattern for Activity Sharer (`activity-sharer` folders and `mb-activity-sharer` skill).

## 3. Restart and check

1. Close the canvas, restart the app (or start a new session). Running canvases keep the old code.
2. `copilot plugin list` shows the new version.
3. Type `/mb-release-sharer` in a session: the canvas opens. Select a release: a "Merged PRs" row appears (0.2.0 and later).
4. Your saved width, format and options are kept (stored in `state.json`). Reset by deleting that file.

## If it did not update

| Symptom | Fix |
|---|---|
| Version unchanged | Refresh the marketplace first, then update; else uninstall and reinstall |
| Old UI still shown | Restart the app; close and reopen the canvas |
| Skill not listed | Restart; check `copilot plugin list`; copy the skill folder to `~/.copilot/skills/` |
| Plugin errors on start | Check `~/.copilot/logs/extensions/`; reinstall |
