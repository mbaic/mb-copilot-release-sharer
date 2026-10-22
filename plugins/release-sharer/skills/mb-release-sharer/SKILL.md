---
name: mb-release-sharer
description: Open the Release Sharer canvas to pick a release of the current GitHub repository and copy it as plain text, Markdown, email or rich HTML. Use when the user wants to share, announce or draft release notes.
---

# Release Sharer

Open the **Release Sharer** canvas (canvas id `release-sharer`) for the current repository.

1. Open the canvas. Pass `repo` (`owner/repo`) only if the user named a repository, and `tag` only if they named a release. Otherwise open it without input: it detects the repository from the session folder.
2. Tell the user in one line that the canvas is open and which repository it shows.
3. If the user asked for a specific release, call the canvas action `select_release` with its tag (use `list_releases` first if you need to find it).
4. Do not paste release notes into the chat unless asked. The canvas does the formatting and copying. For a short summary for an audience, use `get_release` and then `set_draft` so the user can review and copy it from the canvas.

If you cannot open canvases in this session, say so and offer `render_share` output instead, or point the user to the install steps in the plugin README.
