# Changelog

This file covers Release Sharer. Activity Sharer has its own: [plugins/activity-sharer/CHANGELOG.md](plugins/activity-sharer/CHANGELOG.md).

## 0.2.2 (unreleased)

- Email no longer ends with "Best regards".
- Closing block in every format: blank-line separated, link line "Full release notes and app for download: <url>", then the install note ("Download a new app/PTE app from the link above, extract and install in sandboxes first, then prod environment:" and `[screenshot-placeholder]`). Both only with the Link option on.
- Copy puts HTML and plain text on the clipboard in every format, so links (PRs, full release notes) are clickable when pasted into Outlook, Teams or Gmail.
- Removed the Rich HTML tab and "Open in mail client" (did not work with new Outlook). Email tab has "Copy email" and "Copy subject".

## 0.2.0 (unreleased)

- merged pull request links per release (from the notes plus the commits since the previous release): "Merged PRs" row in the canvas, "Pull requests" option for every format, `get_release_prs` agent action.
- start skill `mb-release-sharer` that opens the canvas.

## 0.1.0 (unreleased)

- plugin and marketplace manifests, CI, manifest checks, install smoke test.
- release parsing, cleaning, plain/Markdown/email/rich HTML formatters.
- repo detection (git remote, manual override), release loading via `gh` with cache and pagination.
- UI with filter, search, editable preview with undo, copy with fallbacks, error states, themes, accessibility.
- resizable persisted split, narrow layout.
- agent actions `list_releases`, `get_release`, `render_share`, `select_release`, `set_draft`; agent rewrite.
- docs, release workflow, security and contributing notes.
