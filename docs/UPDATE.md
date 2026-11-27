# Update Release Sharer and Activity Sharer in the GitHub Copilot app

Steps marked (unverified) were not run in the real app yet; note any difference in `docs/TESTING.md`.

Your installed copy only changes when you update it. Each plugin has its own version and updates only when that version changes: Release Sharer in [CHANGELOG.md](../CHANGELOG.md), Activity Sharer in [its changelog](../plugins/mb-activity-sharer/CHANGELOG.md). Updating one never touches the other. The commands below use `mb-release-sharer`; for Activity Sharer replace the plugin name with `mb-activity-sharer` (marketplace stays `mb-release-sharer`), e.g. `copilot plugin update mb-activity-sharer@mb-release-sharer`.

## Migrating from the pre-0.3.0 names (unverified in the real app)

0.3.0 renamed the marketplace (`release-sharer` to `mb-release-sharer`) and the plugins (`release-sharer` to `mb-release-sharer`, `activity-sharer` to `mb-activity-sharer`). The app treats these as new names, so a normal update will not find them. Remove the old ones and add the new:

```
copilot plugin uninstall release-sharer
copilot plugin uninstall activity-sharer
copilot plugin marketplace remove release-sharer
copilot plugin marketplace add mbaic/mb-copilot-release-sharer
copilot plugin install mb-release-sharer@mb-release-sharer
copilot plugin install mb-activity-sharer@mb-release-sharer
```

Skip the uninstall line for a plugin you never installed. In the app, do the same under Customize > Plugins (unverified UI wording). Restart the app afterwards; the canvas ids are now `mb-release-sharer` and `mb-activity-sharer`. If you used the manual folder install, delete `~/.copilot/extensions/release-sharer/` and `~/.copilot/extensions/activity-sharer/` and copy the new `mb-` folders. Your saved preferences live in `state.json` in the old folder; copy it into the new folder to keep them. Please note in `docs/TESTING.md` whether this worked.

## 1. See what is installed

```
copilot plugin list
```

Note the `mb-release-sharer` version. Compare with the top heading of [CHANGELOG.md](../CHANGELOG.md).

## 2. Update

In the Copilot app: Customize > Plugins > Marketplaces > refresh `mbaic/mb-copilot-release-sharer`, then update `mb-release-sharer` (unverified UI wording).

Or CLI:

```
copilot plugin marketplace update mb-release-sharer
copilot plugin update mb-release-sharer@mb-release-sharer
```

If your CLI has no `update` command or the version stays the same, reinstall:

```
copilot plugin uninstall mb-release-sharer
copilot plugin marketplace update mb-release-sharer
copilot plugin install mb-release-sharer@mb-release-sharer
```

If the marketplace was added from a local clone, run `git pull` in the clone first, then the commands above.

Manual install (copied folder): replace `~/.copilot/extensions/mb-release-sharer/` (Windows: `%USERPROFILE%\.copilot\extensions\mb-release-sharer\`) with the new `plugins/mb-release-sharer/com.github.copilot/extensions/mb-release-sharer/`. Keep `state.json` there if you want to keep your saved preferences. If you use the start skill without the plugin, also copy `plugins/mb-release-sharer/skills/mb-release-sharer/` to `~/.copilot/skills/`. Same pattern for Activity Sharer (`mb-activity-sharer` folders and `mb-activity-sharer` skill).

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
