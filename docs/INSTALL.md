# Install and test Release Sharer and Activity Sharer

The marketplace holds two independent plugins: `release-sharer` and `activity-sharer`. Install either or both; neither needs the other. Sections 1-5 are Release Sharer; Activity Sharer is in section 6.

Steps marked (unverified) follow GitHub docs but were not run in the real app yet; if one differs, note the exact message in `docs/TESTING.md`.

## 1. Prerequisites

- GitHub Copilot app (or Copilot CLI) with plugin/canvas support. An org admin may disable plugins; do not bypass it.
- [GitHub CLI](https://cli.github.com) `gh`, logged in: `gh auth login`, then `gh auth status`. The canvas uses your `gh` login; it never sees a token.
- A GitHub repo with published releases, cloned locally, `origin` on github.com (GitHub Enterprise is not supported yet).
- Git on PATH. Node is not needed to run the plugin (the app provides it); Node 22+ only to run `npm run ci`.

## 2. Install

Copilot app: Customize > Plugins > add marketplace `mbaic/mb-copilot-release-sharer` > install `release-sharer` (unverified UI wording).

Or CLI:

```
copilot plugin marketplace add mbaic/mb-copilot-release-sharer
copilot plugin install release-sharer@release-sharer
copilot plugin list
```

Use the branch before it is merged: clone it and add the local folder instead (`copilot plugin marketplace add /path/to/mb-copilot-release-sharer`).

Manual fallback if the plugin route fails (unverified): copy `plugins/release-sharer/com.github.copilot/extensions/release-sharer/` to `~/.copilot/extensions/release-sharer/` (Windows: `%USERPROFILE%\.copilot\extensions\release-sharer\`), then restart the app.

Approve the extension if the app asks. Restart the app or start a new session if the canvas is not listed.

## 3. Open the canvas

1. Start a session in your repo folder.
2. Ask the agent: "Open the Release Sharer canvas", or use the start skill `mb-release-sharer` (type `/mb-release-sharer`, or ask the agent to use that skill). You can also launch it from the app's canvas list if shown.
3. The top bar shows `owner/repo` and the releases load. If not detected, click the repo label, type `owner/repo`, press Enter.

## 4. Test with a real repo

1. Select a release. Try the four tabs and the three options (Clean, Contributors, Link).
2. Edit the preview, switch tab: "Edits replaced · Undo" appears.
3. Copy, then paste into Outlook/Teams/Gmail/Word. Rich HTML should keep bold, bullets and links.
4. Email tab: "Open in mail client".
5. Drag the splitter, reopen the canvas: width persists.
6. "Rewrite with agent": pick Customers or Internal; the draft appears when the agent answers.
7. Ask the agent: "list releases with the canvas", "render v1.2.3 as email", "select v1.2.2".

Record results in `docs/TESTING.md` and send me the table.

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| Canvas not listed | Restart the app or start a new session; check the plugin is enabled; try the manual copy |
| "GitHub CLI (gh) was not found" | Install `gh`; start the app from a terminal once to compare PATH; Retry |
| "Run gh auth login" | Run it in a terminal, Retry |
| "Repository not found or no access" | Check the repo name; `gh repo view owner/repo`; SSO-protected orgs need `gh auth refresh` |
| "Rate limit reached" | Wait for the shown reset time |
| "Could not detect a repository" | Folder has no GitHub `origin`; enter `owner/repo` manually |
| Copy fails | Select the text and press Ctrl/Cmd+C; report it |
| Blank panel | Check `~/.copilot/logs/extensions/`; report the error lines |
| Rewrite does nothing | The agent may need to call `set_draft`; report whether it did |

Updating to a new version: [UPDATE.md](UPDATE.md).

Uninstall: `copilot plugin uninstall release-sharer` (or remove the manual folder).

## 6. Activity Sharer

Same prerequisites as section 1 (`gh` logged in); no repo folder is needed because it shows your own activity across all repos.

```
copilot plugin marketplace add mbaic/mb-copilot-release-sharer   # once, skip if already added
copilot plugin install activity-sharer@release-sharer
copilot plugin list
```

Verify: `copilot plugin list` shows `activity-sharer` at the version in [its changelog](../plugins/activity-sharer/CHANGELOG.md) (unverified wording). Open the canvas by asking the agent "open the Activity Sharer canvas" or `/mb-activity-sharer`. Pick a range, select a tile, try "Write it up", and ask the agent "what did I do in the last 30 days?" (it should call `get_activity`). Installing or removing it must not change `release-sharer` (check S9 in [TESTING.md](TESTING.md)).

Uninstall: `copilot plugin uninstall activity-sharer`. Manual fallback (unverified): copy `plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/` to `~/.copilot/extensions/activity-sharer/`.
