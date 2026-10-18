# Security

Report vulnerabilities privately via GitHub: Security > Report a vulnerability. No public issues for security bugs.

Supported: latest `0.x` release.

## Threat model

- The extension runs with your user privileges. Review the source before installing.
- Local server: binds `127.0.0.1` only; random per-instance token in the URL path; Host and Origin checks; JSON-only POSTs, 64 KB cap; strict CSP.
- Release notes are untrusted: all output is escaped, only `http(s)` links survive, nothing is executed or passed to a shell; the agent prompt fences them as data.
- `git`/`gh` run via `execFile` with argument arrays; `owner/repo` is validated first.
- No tokens are read, stored or logged (`gh` authenticates). No telemetry; the only network calls are `gh` to GitHub.
- State file holds UI prefs and repo names only.
