# Platform findings

Only results the owner ran and reported are marked `answered`. Everything else is `unverified`: the code follows PLAN assumptions and has a fallback. Record results while following `docs/TESTING.md`.

| ID | Question | Status | Built-in assumption / fallback | Result (owner) |
|---|---|---|---|---|
| U1 | Node version in the app | unverified | CI tests Node 22 and 24; code avoids newer APIs | |
| U2 | `gh` found when the app starts from the GUI | unverified | `gh` plus known install paths; else `gh_missing` state | |
| U3 | Clipboard (`writeText`, rich `write`, `execCommand`), `mailto:`, pointer capture | unverified | Fallback chain in `ui/clipboard.js`; mail falls back to copy | |
| U4 | Page renders with `frame-ancestors 'none'` | unverified | Header omitted (not sent) | |
| U5 | Install via app / CLI / VS Code, launch method, restart | unverified | Manual copy to `~/.copilot/extensions/release-sharer/` | |
| U6 | `session.send` then agent calls `set_draft` then UI updates | unverified | Rewrite button shown; hide it if it fails (F-16 moves to v0.2) | |
| U7 | Panel default/min width | unverified | 640 px narrow breakpoint | |
| U8 | `session.log` options shape | unverified | Called as `log(msg, {level})`; falls back to `console.error` | |

Other unverified: `<COPILOT_HOME>/extensions/release-sharer/` is writable (else prefs are not saved); `ctx.session.workingDirectory` is set; worktree repos resolve via `git remote`; `GH_TOKEN` is never needed (`gh` authenticates).
