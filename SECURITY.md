# Security

Report vulnerabilities privately via GitHub: Security > Report a vulnerability. No public issues for security bugs.

Supported: latest `0.x` release of each plugin (Release Sharer, Activity Sharer).

## Threat model

- The extension runs with your user privileges. Review the source before installing.
- Local server: binds `127.0.0.1` only; random per-instance token in the URL path; Host and Origin checks; JSON-only POSTs, 64 KB cap; strict CSP.
- Release notes are untrusted: all output is escaped, only `http(s)` links survive, nothing is executed or passed to a shell; the agent prompt fences them as data.
- `git`/`gh` run via `execFile` with argument arrays; `owner/repo` is validated first.
- No tokens are read, stored or logged (`gh` authenticates). No telemetry; the only network calls are `gh` to GitHub.
- State file holds UI prefs and repo names only.

### Activity Sharer

- Reads the signed-in user's own activity through `gh api graphql` (`execFile`, argument array, no shell); search strings are built from a validated login and ISO dates only.
- Stores nothing and has no state file. No tokens are read or logged; no telemetry.
- PR and issue titles are untrusted: escaped on output and fenced as data in agent prompts. Agent drafts are treated as untrusted text, and links in them render only if they match a known item URL.
- Local server: binds `127.0.0.1` only; random per-instance token in the URL path; Host and Origin checks; JSON-only POSTs, 16 KB cap; strict CSP; only an allow-list of UI and `lib/` files is served.
- All output is built from text nodes (no `innerHTML`); links render only for `http(s)` URLs, and in agent drafts only when they match a known item URL or `owner/repo #n`.
- The agent prompt fences activity data as DATA. `get_activity` and `set_draft` are the only agent-facing actions; `set_draft` text is sanitized (control characters removed, 1 to 4,000 characters).
- The evidence check flags links, references, dates and numbers that are not in the user's data. It reduces mistakes; it does not prove a draft is true, and number words ("three") are not checked.
