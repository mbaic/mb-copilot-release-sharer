# Release Sharer

A canvas for the GitHub Copilot app: pick a release of the current repo and copy it as plain text, Markdown, email or rich HTML.

![Release Sharer](docs/img/preview.png)

- Auto-detects the repo (or type `owner/repo`), lists releases with filter and search.
- Cleans PR refs and @mentions, adds contributors and a release link, editable preview with undo.
- "Rewrite with agent" for Customers or Internal; the agent can also list, render and select releases.
- Resizable split view, narrow layout, light/dark, keyboard accessible.

## Install

```
copilot plugin marketplace add mbaic/mb-copilot-release-sharer
copilot plugin install release-sharer@release-sharer
```

Full steps and troubleshooting: [docs/INSTALL.md](docs/INSTALL.md). Requires `gh` logged in. Extensions run with your user privileges; review the source before installing.

## Status

0.1.0, not released. Built to [the plan](.project/release-sharer-PLAN.md); platform behavior is still being verified in the real app ([findings](docs/FINDINGS.md), [tests](docs/TESTING.md)).

## Development

Node 22+, no dependencies: `npm run ci`, `npm run dev`, `npm run smoke`. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
