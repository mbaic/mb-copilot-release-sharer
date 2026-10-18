# Roadmap

> **Current phase:** v0.1 built; waiting for owner's real-app tests
> **Next gate:** owner tests per `docs/TESTING.md`, then v0.1 release (tag)
> **Last updated:** 2026-10-18

The spec for every item is in [`docs/PLAN.md`](docs/PLAN.md). This file is the single source of truth for **scope and status**. Update it in the same commit as the work. Status values: `todo` · `doing` · `done` · `cut`.

## Phase report

_Written by the implementer at each gate, newest first. Format: date, phase, shipped IDs, cut or moved IDs (and why), surprises (link to `docs/FINDINGS.md`), proposed next scope._

_(none yet)_

## P0: Platform check

| ID | Item | Status | Notes |
|---|---|---|---|
| P-0 | Platform checks U1–U8 (PLAN §3.3) | doing | Spike and `docs/TESTING.md` prepared; waiting for owner results in `docs/FINDINGS.md`. U5 stays open until M1. |

## v0.1: First usable release

| ID | Item | Milestone | Status | Notes |
|---|---|---|---|---|
| F-18 | Packaging: plugin + marketplace manifests, preview image, manual install | M1 | done* | built; platform behavior unverified (see FINDINGS) |
| F-19 | CI, manifest checks, install smoke test | M1 | done* | built; platform behavior unverified (see FINDINGS) |
| F-04 | Parse release body into a model, plus cleaning | M2 | done* | built; platform behavior unverified (see FINDINGS) |
| F-05 | Plain text format | M2/M5 | done* | built; platform behavior unverified (see FINDINGS) |
| F-06 | Markdown format | M2/M5 | done* | built; platform behavior unverified (see FINDINGS) |
| F-07 | Email format and "Open in mail client" | M2/M5 | done* | built; platform behavior unverified (see FINDINGS) |
| F-08 | Rich HTML format (html + plain clipboard) | M2/M5 | done* | built; platform behavior unverified (see FINDINGS) |
| F-09 | Toggles: clean, contributors, link | M2/M5 | done* | built; platform behavior unverified (see FINDINGS) |
| F-01 | Repo detection and manual override | M3/M7 | done* | built; platform behavior unverified (see FINDINGS) |
| F-02 | Release list, Load more, drafts hidden, badges | M3/M5 | done* | built; platform behavior unverified (see FINDINGS) |
| F-03 | Filter and search | M5 | done* | built; platform behavior unverified (see FINDINGS) |
| F-10 | Editable preview with regenerate and Undo | M5 | done* | built; platform behavior unverified (see FINDINGS) |
| F-11 | Copy with fallbacks | M5 | done* | built; platform behavior unverified (see FINDINGS) |
| F-14 | Error and empty states | M5 | done* | built; platform behavior unverified (see FINDINGS) |
| F-17 | Light/dark theme and accessibility baseline | M5/M9 | done* | built; platform behavior unverified (see FINDINGS) |
| F-12 | Resizable split, persisted | M6 | done* | built; platform behavior unverified (see FINDINGS) |
| F-13 | Narrow layout and list collapse | M6 | done* | built; platform behavior unverified (see FINDINGS) |
| F-15 | Agent actions: list, get, render, select | M7 | done* | built; platform behavior unverified (see FINDINGS) |
| F-16 | Agent rewrite via `set_draft` (may move to v0.2 at gate) | M8 | done* | built; platform behavior unverified (see FINDINGS) |
| F-20 | Docs and `v0.1.0` release | M9/M10 | doing | docs done; tag/release pending owner |

`done*` = built and unit/browser tested; real-app verification pending (`docs/TESTING.md`). Gate suspended by the override below; v0.1.0 tag waits for the owner.

## v0.2: Planned (scope confirmed at the v0.1 review)

| ID | Item | Milestone | Status | Notes |
|---|---|---|---|---|
| F-21 | Source pane with horizontal splitter | M11 | todo | |
| F-22 | GitHub Enterprise Server hosts | M12 | todo | Keep only if needed |
| F-23 | REST fallback without `gh` | M13 | todo | |
| F-24 | Copy split: subject / body | M14 | todo | |
| F-25 | Show-drafts toggle | M15 | todo | |

## Backlog (not planned; never built without moving into a phase)

| ID | Item |
|---|---|
| B-01 | Custom templates with placeholders |
| B-02 | Hide bot changes toggle |
| B-03 | Release range ("everything since vX") |
| B-04 | Post directly to Teams/Slack/Discussions |
| B-05 | Localization |
| B-06 | Export `.eml` |
| B-07 | Submit to `github/awesome-copilot` |

## Decisions

_Append-only. Format: `YYYY-MM-DD: decision, reason (IDs affected)`._

- 2026-10-18: Phased delivery (P0 → v0.1 → v0.2); scope tracked here by ID. (all)
- 2026-10-18: Repo is `mbaic/mb-copilot-release-sharer` (supersedes the earlier name `copilot-release-sharer`); marketplace and plugin id stay `release-sharer`. (F-18)
- 2026-10-18: Agent rewrite uses a single `set_draft` canvas action instead of a request-id broker. (F-16)
- 2026-10-18: Contributors line: no `@` when clean is on, `@handles` when clean is off. Drafts hidden in v0.1. (F-09, F-02)
- 2026-10-18: `<GITHUB_USER>` and `<AUTHOR NAME>` both resolved to `mbaic`. PLAN, manifests and install commands use them. (F-18, F-20)
- 2026-10-18: Planning files stay in `.project/` for now (not moved to `ROADMAP.md` and `docs/PLAN.md`); read the plan's file paths as the `.project/release-sharer-*.md` files until the owner moves them. (all)
- 2026-10-18: Exception to current-phase-only: M2 (pure core, F-04 to F-09 logic) may run in parallel with P-0, because it does not depend on U1 to U8. (F-04..F-09)
- 2026-10-18: Owner override: phase gates suspended; build all v0.1 IDs (M3..M10 code and docs) in one go, plus an install guide (`docs/INSTALL.md`). Platform checks (P-0 U-items, M1 U5, manual tests) are deferred to the owner's real-app testing; code follows PLAN assumptions and every unverified spot is marked `unverified` in `docs/FINDINGS.md`. No tags or releases without the owner. v0.2 items stay out of scope. (all v0.1)
