# Testing in the real Copilot app

Automated: `npm run ci` (unit, golden, server, canvas, UI logic), `npm run dev` (UI in a browser, mocked GitHub; `--error=gh_missing|gh_not_authenticated|rate_limited|repo_not_found|network|unsupported_host`, `--no-rewrite`). Chromium checks of the UI are done; the platform checks below need your machine. Fill the Result column, then tell me; findings go to `docs/FINDINGS.md`.

Setup: follow `docs/INSTALL.md`. Use a repo with several releases (one pre-release, one with PR links and `@mentions`, one with an empty body if possible).

| # | Check | Expected | Result |
|---|---|---|---|
| 1 | Install from the marketplace (app, then CLI, then VS Code) | Plugin listed; canvas launchable; note approval prompts, restart, how launched (U5) | |
| 2 | Open the canvas in a repo folder | Repo label shows `owner/repo`, releases load (U2) | |
| 3 | Open it in a worktree and in a non-git folder | Worktree resolves; non-git shows the manual `owner/repo` field | |
| 4 | Select a release; try each tab and each option; edit text; change tab | Preview regenerates; "Edits replaced · Undo" works | |
| 5 | Copy in each format; paste into Outlook desktop/web, Teams, Gmail, Word, plain editor | Plain/Markdown/Email paste as text; Rich HTML keeps bold, list, links (U3) | |
| 6 | Email tab: Open in mail client | Mail opens with subject and body, or the body is copied (U3) | |
| 7 | Drag the splitter, use arrow keys, reopen the canvas | Width persists; panel narrower than 640 px shows the dropdown (U3, U7) | |
| 8 | Log out of `gh` (`gh auth logout`), reopen; also try a repo you cannot access | Clear "Run gh auth login" / "not found" states | |
| 9 | Rewrite with agent (Customers, Internal) | Chat shows the rewrite request; the draft appears with a "Rewritten by agent" chip; Revert works (U6) | |
| 10 | Ask the agent: "list the releases with the Release Sharer canvas", "render v2.4.1 as email", "select v2.4.0", "shorten the draft" | Each action works; selection and draft update live | |
| 11 | Dark and light theme; keyboard only; reduced motion | Usable and readable | |
| 12 | Log: note the node version and where extension logs go (`~/.copilot/logs/extensions/`) | Recorded for U1, U8 | |

If something fails, copy the exact error and the extension log lines. The old platform spike (`spike/release-sharer-spike/`) can be copied to `~/.copilot/extensions/` to probe clipboard, CSP and `session.send` in isolation.
