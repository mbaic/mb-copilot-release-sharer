# Testing in the real Copilot app

Sections: Release Sharer checks 1-17, then Activity Sharer (spike S1-S10).

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
| 13 | Select a release whose notes name PRs, then one with hand-written notes (no PR refs) that follows an older release | "Merged PRs" row shows `#n` links (opens the PR in the browser); the "Pull requests" option adds a "Pull requests:" list to every format; hand-written releases still get links from the commits since the previous release (U9) | |
| 14 | Untick "Pull requests"; refresh with the Reload button | Row stays, list leaves the copied text; refresh re-fetches without errors | |
| 15 | After install, type `/mb-release-sharer` or ask "use the mb-release-sharer skill" | The skill is listed and opens the canvas for the current repo; note how it is invoked (U10) | |
| 16 | Ask the agent: "which PRs are in v2.4.1?" | It calls `get_release_prs` and lists number, title, URL | |
| 17 | Copy on each tab, paste into new Outlook, Teams, Gmail | Release link and PR numbers are clickable; Email tab: Copy subject works (U3) | |
| 12 | Log: note the node version and where extension logs go (`~/.copilot/logs/extensions/`) | Recorded for U1, U8 | |

If something fails, copy the exact error and the extension log lines.

## Activity Sharer

Cloud sessions cannot run these: GitHub GraphQL is blocked there, and the app, clipboard and your real account are on your computer. Never mark a check passed without a result you ran yourself. Results go to this table; platform answers go to `docs/FINDINGS.md` (A-rows, plus the shared U6 and U10).

### Run the spike (S1-S8)

Prerequisites: Node 22+, `gh` logged in (`gh auth status`) as the account you want to measure, repo cloned (no `npm install` needed).

```
node scripts/spike-activity.mjs --range 30d
```

`--range` is `7d`, `30d`, `90d`, `6m` or `12m`; `--no-redact` shows real titles, repo names and your login (default masks them). Run `30d` and `12m` at least. The script is read-only, reads no token and prints one JSON report: `counts` (current and previous window; `mergedSearch` and `prevMergedSearch` show `issueCount` against listed `nodes`), `repos`, `repoCount`/`orgCount`, `rateLimit`, `agentCandidates` (branch prefixes and PR authors for your merged and open PRs) and a redacted `sample`. If GraphQL returns errors, they print to stderr first.

Compare against GitHub itself:
- S2: your profile (github.com/<you>) for the same dates: PRs opened, reviews, issues. Compare with `counts.current`.
- S6: github.com/pulls search `is:pr author:<you> merged:<from>..<to>` count against `counts.mergedSearch.issueCount`, and whether some PRs were opened before the window.
- S3/S4/S5: look at `repos` and `orgCount`; for an SSO org you have not authorised, note the stderr text and which parts are missing; for private repos, itemised rows or `restrictedContributions`.
- S7: list your own agent PRs (Copilot coding agent, `claude/` or `copilot/` branches) and compare with `agentCandidates` and whether Copilot-on-behalf PRs appear in `mergedSearch`.
- S8: `rateLimit.cost`.

| # | Check | Expected | Result |
|---|---|---|---|
| S1 | Query with two aliased `contributionsCollection` and four searches runs with the existing `gh` login | JSON with `cur`, `prev`, `merged`, `open`, `reviewRequests` | |
| S2 | Opened, reviews, issues match the GitHub profile for the same window | equal totals | |
| S3 | Repos from two or more orgs appear | yes | |
| S4 | SSO org without authorisation: what each part returns | missing repos; error text noted | |
| S5 | Private repo activity | itemised or in `restrictedContributionsCount` | |
| S6 | `merged:` search by login returns PRs opened before the window | yes; count matches GitHub's web search | |
| S7 | Agent detection on the owner's real PRs: Copilot-on-behalf PR appears in `author:` search via API; `claude/` and `copilot/` branch prefixes | matches the owner's own list | |
| S8 | Rate-limit cost of the request | about 1-3 points | |
| S9 | Two plugins install and update independently (`npm run smoke`, then bump-and-update one in the app) | yes | |
| S10 | Write-up round trip: `session.send` then `set_draft` updates the canvas (shares Release Sharer U6) | draft appears; check runs | |

S9 setup: `npm run smoke` (needs the `copilot` CLI) installs both plugins into an isolated home; then in the real app install `activity-sharer@release-sharer` and confirm `release-sharer` stays at its version and the canvas list shows both. S10 can only be run once AS-02 ships the write-up; until then it stays empty.

S9 and S10 above are also covered by the app checks below.

### Activity Sharer app checks (0.2.2)

Automated: `npm run ci` (about 140 Activity Sharer tests), `npm run dev:activity` (UI in a browser with made-up data; `-- --error=gh_missing|gh_not_authenticated|rate_limited|network`, `--partial`, `--bad-draft`, `--no-writeup`). Run S1-S8 first; the checks below need the real app. Fill the Result column and send it to me.

| # | Check | Expected | Result |
|---|---|---|---|
| AS-1 | Install `activity-sharer@release-sharer`; open the canvas from `/mb-activity-sharer` and by asking for it | Canvas lists and opens; skill is listed (U10); Release Sharer unaffected (S9) | |
| AS-2 | Open with the default range | Header shows your login and window dates; summary, tiles, insights, open loops, chart and repo table appear within a few seconds | |
| AS-3 | Compare the tiles for 30 days with your GitHub profile and `is:pr author:<you> merged:` search; "Open PRs now" with `is:pr is:open author:<you>` | Equal totals (S2, S6); every listed item links to the right page | |
| AS-4 | Switch through all five ranges | Each loads; 12 months works (A4); the chart changes unit (day, week, 30 days) | |
| AS-5 | Organization menu with two or more orgs: tick a subset, tick all, try to untick the last one, Select all, Escape | Everything narrows without a refetch; deltas for reviews and issues say "no comparison when filtered"; all ticked = no filter; the last tick cannot be removed | |
| AS-6 | Select each tile | Items list with title link, `owner/repo #n`, date; note shows "Showing n of N" when capped | |
| AS-7 | Open loops | Your open PRs with age (tag when older than 7 days) and review requests waiting on you match GitHub | |
| AS-8 | Write it up: Standup, then 1:1 or self-review, then Client update | Chat shows the request; a draft appears; the check banner passes or lists real mismatches; links in the draft open the right PRs (U6, S10) | |
| AS-9 | Copy text and Copy Markdown; paste into Teams, Outlook, a Markdown editor | Text pastes as written; Markdown has links for known refs (U3) | |
| AS-10 | Ask the agent: "what did I merge last month?", "draft my Q3 self-review" (range 90d), "standup for today" | It calls `get_activity`, cites URLs from the data, then `set_draft`; numbers match the canvas | |
| AS-11 | `gh auth logout`, reopen; rename `gh` temporarily or start the app without PATH if you can | "GitHub CLI is not signed in" with a Copy button / "gh was not found"; Retry works | |
| AS-12 | If you have an SSO org you have not authorised | A banner says some organizations were not returned; the rest is shown (S4) | |
| AS-13 | Dark and light theme; narrow panel; keyboard only | Readable, tiles are buttons with `aria-expanded`, no horizontal scroll | |
| AS-14 | After S7: send me the result | Agent tagging is switched on only after you report S7 | |

If something fails, copy the exact error and the extension log lines (`~/.copilot/logs/extensions/`).
