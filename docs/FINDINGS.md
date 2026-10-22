# Platform findings

Only results the owner ran and reported are marked `answered`. Everything else is `unverified`: the code follows the assumptions below and has a fallback. Record results while following `docs/TESTING.md`.

| ID | Question | Status | Built-in assumption / fallback | Result (owner) |
|---|---|---|---|---|
| U1 | Node version in the app | unverified | CI tests Node 22 and 24; code avoids newer APIs | |
| U2 | `gh` found when the app starts from the GUI | unverified | `gh` plus known install paths; else `gh_missing` state | |
| U3 | Clipboard (`writeText`, rich `write`, `execCommand`), `mailto:`, pointer capture | unverified | Fallback chain in `ui/clipboard.js`; mail falls back to copy | |
| U4 | Page renders with `frame-ancestors 'none'` | unverified | Header omitted (not sent) | |
| U5 | Install via app / CLI / VS Code, launch method, restart | unverified | Manual copy to `~/.copilot/extensions/release-sharer/` | |
| U6 | `session.send` then agent calls `set_draft` then UI updates | unverified | Rewrite button shown; hide it if it fails | |
| U7 | Panel default/min width | unverified | 640 px narrow breakpoint | |
| U8 | `session.log` options shape | unverified | Called as `log(msg, {level})`; falls back to `console.error` | |
| U9 | PR links: `gh api repos/{o}/{r}/compare/{prev}...{tag}` works for the owner's repos; PRs found are all merged | unverified | Notes' PR refs are used as written; compare failure keeps those and flags the list partial | |
| U10 | Plugin `skills/<name>/SKILL.md` is discovered without a `skills` key in `plugin.json`, and how it is invoked | unverified | Skill sits in `plugins/release-sharer/skills/mb-release-sharer/`; no manifest key. If not discovered, the skill can be copied to `~/.copilot/skills/` | |

### Activity Sharer (A-rows)

Same rule: `answered` only with the owner's reported result. Shared platform questions are not duplicated: agent round trip is **U6**, skill discovery is **U10**, clipboard is **U3**.

| ID | Question | Status | Built-in assumption / fallback | Result (owner) |
|---|---|---|---|---|
| A1 | One `gh api graphql` request with two aliased `contributionsCollection` and four `search` fields runs and returns `cur`, `prev`, `merged`, `open`, `reviewRequests` (S1) | unverified | Query in `lib/query.mjs`; split into several requests if a field is rejected | |
| A2 | Variables pass as `-f` strings (no `-F` coercion) and `DateTime`/`String` accept them | unverified | `ghGraphqlArgs` uses `-f` only | |
| A3 | `merged:<ISO datetime>..<ISO datetime>` with `author:<login>` accepts time-of-day bounds and returns PRs opened before the window (S6) | unverified | Fall back to date-only bounds (`YYYY-MM-DD`) | |
| A4 | A 365-day `contributionsCollection` span is accepted for 12 months; 100-repo and 100-node caps are not hit (S1, S2) | unverified | Cap range to what the API accepts; "showing latest 100" when `totalCount` exceeds nodes | |
| A5 | Counts from `contributionsCollection` equal the GitHub profile; private repos itemised or in `restrictedContributionsCount` (S2, S5) | unverified | Show private count as "not listed" | |
| A6 | Behaviour for an SSO org without an authorised session, per query part (S4) | unverified | Banner for the missing org; the rest still shown | |
| A7 | `rateLimit.cost` of the request is about 1-3 points (S8) | unverified | Cache per (range, window); Refresh refetches | |
| A8 | Copilot-coding-agent PRs opened for the user appear in `author:<login>` search through the API, and `copilot/` / `claude/` branch prefixes match the owner's real agent PRs (S7) | unverified | Ship without the agent tag and insight | |
| A9 | `marketplace.json` with two plugins: each installs, updates and uninstalls independently; the marketplace `metadata.version` bump is harmless (S9) | unverified | Install separately; report the exact message if one affects the other | |
| A10 | `gh api graphql` is usable from the extension process (PATH, auth) the same way `gh api repos/...` is for Release Sharer (U2) | unverified | `gh_missing` / `gh_not_authenticated` states | |
| A11 | `session.send` from the canvas, then the agent calls `set_draft`, and the draft appears (AS-8, S10); shares **U6** | unverified | "Write it up" buttons hide if the request fails; `get_activity` stays available | |
| A12 | The agent calls `get_activity` for "what did I do" questions once the skill is discovered (AS-10) | unverified | Ask explicitly: "use the get_activity action of the Activity Sharer canvas" | |
| A13 | Canvas action `inputSchema` with `enum` and optional properties is accepted as written | unverified | Drop `enum`, keep the description | |
| A14 | `gh api graphql` exits non-zero but still prints `data` when part of the query is denied (SSO); the wrapper uses that stdout (S4) | unverified | Without it the whole load fails with the "GitHub denied access" state | |
| A15 | The evidence check's date and number rules do not flag ordinary agent drafts (false positives) (AS-8) | unverified | The check only flags; it never blocks copying | |

Other unverified: `<COPILOT_HOME>/extensions/release-sharer/` is writable (else prefs are not saved); `ctx.session.workingDirectory` is set; worktree repos resolve via `git remote`; `GH_TOKEN` is never needed (`gh` authenticates).
