# Platform findings

Platform facts discovered by running things in the real Copilot app. Source of truth for P0 (PLAN §3.2, §3.3). **An item is only marked `answered` or `fallback` from a result the owner ran and reported.** Nothing here is simulated.

Status values: `open` · `answered` · `fallback` (check failed, fallback from PLAN §3.2 adopted).

## P0 results

Evidence = which spike section and scenario produced it (see `docs/TESTING.md`). Date format `YYYY-MM-DD`.

| ID | Question (short) | Status | Result | Fallback adopted | Evidence | Plan sections to update |
|---|---|---|---|---|---|---|
| U1 | Node version the app runs extensions on | open | | | | §5 `engines`, §16 CI matrix |
| U2 | `gh` resolves from a GUI-launched app; `gh auth token` works | open | | | | §7.3, §14, §18 risk 3 |
| U3 | Clipboard paths, `mailto:`, pointer capture, `localStorage` across reopen | open | | | | §11.7, §11.4 |
| U4 | Page renders with CSP `frame-ancestors 'none'`; panel is webview or iframe | open | | | | §9 CSP header |
| U5 | Plugin install, canvas visible, launch method, restart needed (app, CLI, VS Code) | open | | | | answered in M1, not P-0 |
| U6 | `session.send` → agent calls `set_draft` → SSE reaches the UI | open | | | | §10, F-16 |
| U7 | Side-panel default and minimum width | open | | | | §11.1 narrow breakpoint |
| U8 | `session.log` options shape | open | | | | §7.5 |

## Additional observations

| Topic | Result | Evidence |
|---|---|---|
| `<COPILOT_HOME>/extensions/release-sharer/` writable (PLAN §7.4) | not yet reported | |
| Env vars the extension process receives (`GH_TOKEN` / `GITHUB_TOKEN` presence only) | not yet reported | |
| Behavior in a git worktree | not yet reported | |
