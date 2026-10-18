# mb-copilot-release-sharer

Canvas for the GitHub Copilot app: pick a release of the current repo and copy it as plain text, Markdown, email or rich HTML. Installable as a plugin.

> Status: pre-release (0.1.0 in development). The canvas is currently a hello-world page; the real UI lands in later milestones.

## Install

```
copilot plugin marketplace add mbaic/mb-copilot-release-sharer
copilot plugin install release-sharer@release-sharer
```

In the Copilot app: Customize > Plugins > add marketplace `mbaic/mb-copilot-release-sharer`, then install `release-sharer`.

**Security notice:** extensions run with your user privileges. Review the source before installing.

## Development

Node 22 or newer, no dependencies.

```
npm run ci      # manifest checks + tests
npm run smoke   # local install smoke test (needs the copilot CLI)
```

Layout: the plugin is committed in its installable form under `plugins/release-sharer/`; the repo root is the marketplace (`.github/plugin/marketplace.json`).
