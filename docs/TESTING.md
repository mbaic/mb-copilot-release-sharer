# Testing

## P-0: platform spike (run on your computer)

The Copilot app cannot run in the cloud, so P-0 is a throwaway extension plus this script. It covers PLAN §3.3 checks 1 to 5 (U1 to U4, U6 to U8). U5 (plugin install) stays open until M1.

You will run the spike in three folders, once with the app started from the GUI. Time needed: about 30 minutes. Results go into the tables below; then paste them into the thread (or the PR) and I record them in `docs/FINDINGS.md`. I mark nothing answered without them.

**Privacy.** The spike never logs token values: it reports only whether `GH_TOKEN`/`GITHUB_TOKEN` exist and the length of `gh auth token` output. The probe JSON does include your PATH entries, working folder and the GitHub remote URL (credentials masked). Redact anything you don't want to share.

### 0. Prepare

1. Get the branch: `git fetch origin && git checkout chore/p-0-spike-prep-41jxdw` in your local clone (or download the `spike/release-sharer-spike/` folder from the PR).
2. Copy the spike into the user extensions folder. Keep all four files together (`extension.mjs`, `index.html`, `page.mjs`, `styles.css`).
   - macOS / Linux: `mkdir -p ~/.copilot/extensions/release-sharer-spike && cp spike/release-sharer-spike/* ~/.copilot/extensions/release-sharer-spike/`
   - Windows (PowerShell): `New-Item -ItemType Directory -Force "$HOME\.copilot\extensions\release-sharer-spike"; Copy-Item spike\release-sharer-spike\* "$HOME\.copilot\extensions\release-sharer-spike\"`
   - If your Copilot home is not `~/.copilot`, use `$COPILOT_HOME`.
3. Fully quit the Copilot app, then **start it from the Dock / Start menu / Spotlight, not from a terminal**. This matters for U2 (PATH as seen by a GUI-launched app).
4. Prepare three folders:
   - **A, normal repo:** a clone of a GitHub repo that has releases, with an `origin` on github.com.
   - **B, worktree:** `git -C <A> worktree add ../spike-worktree` (any branch), then use `../spike-worktree`.
   - **C, non-git:** an empty folder, for example `~/spike-nogit`.

### 1. Run in folder A (normal repo)

Start a new session with folder A. Then:

1. Ask the agent: "Open the Release Sharer Spike canvas." Write down **exactly how the canvas became visible** (agent command, a button, a menu), whether the app asked you to approve the extension, and whether a restart was needed. This is partial evidence for U5 (final answer in M1).
2. In the panel, read the "environment probe" block. Copy it to the results table (section 4).
3. **U3 clipboard.** Click buttons 1 to 4 in order. After each click, note the on-page result, then paste into each target and note what you get:
   - Targets: Outlook desktop, Outlook web, Teams, Gmail (web compose), Word, a plain-text editor (Notepad / TextEdit plain).
   - Buttons 1 and 3 should paste plain text. Buttons 2 and 4 should paste formatted text (bold title, bullet list, blue link).
   - Record per target: `rich` (formatting and link kept), `plain` (text only), `nothing`, or `error`.
4. **U3 mailto.** Click "Open mail client". Note: mail client opened with subject/body filled, opened empty, asked permission, or nothing happened.
5. **U3 splitter.** Drag the handle with the mouse (touch too if you have a touchscreen). Then focus it and press ArrowLeft/ArrowRight. Copy the JSON under the splitter.
6. **U3 localStorage.** Note "visits" and the origin. Close the canvas, reopen it, and note "visits" again (1 → 2 means it survived). If the origin's port changed, say so.
7. **U4 baseline CSP.** The CSP block should show `violations: []` and `inlineStyleAttrApplied: true`. Copy it. Note `isTopWindow` and `ancestorOrigins` (these tell us webview vs iframe).
8. **U6 round trip.** Click "Ask the agent to call set_draft". Watch the chat. Record: did the agent call `set_draft` on its own, did the app ask for approval, did the panel show "set_draft received (nonce matches)", and the elapsed time. Copy the JSON.
9. **U8.** Click "Run session.log probe". Copy the JSON, and note where each "spike U8" message appeared (chat, timeline, a log, or nowhere). Also check `~/.copilot/logs/extensions/` for the stderr lines tagged `[spike]` and note the file name.
10. **U7.** Note the width in the "panel size" block at default size. Then drag the panel to its **narrowest** and **widest** (and pop-out/maximized if the app has it) and record `minInnerWidthSeen` / `maxInnerWidthSeen`.
11. Click "Show all results as JSON" and paste that block into the thread (or attach it).

### 2. Repeat the probe only in folders B and C

For each of B (worktree) and C (non-git): start a new session in that folder, open the spike canvas, and copy the "environment probe" block. Expected: B shows `isLinkedWorktree: true` and a resolved remote; C shows `insideWorkTree: false`. Record what you actually see, including `gh` results.

### 3. U4 variant: `frame-ancestors 'none'`

1. Create the flag file next to the installed spike:
   - macOS / Linux: `echo frame-ancestors-none > ~/.copilot/extensions/release-sharer-spike/csp-mode.txt`
   - Windows: `"frame-ancestors-none" | Set-Content "$HOME\.copilot\extensions\release-sharer-spike\csp-mode.txt"`
2. Close and reopen the canvas in folder A (new session if it does not pick the file up). The status line should read `csp frame-ancestors-none`.
3. Record: **renders normally**, **blank/blocked**, or **error message** (copy it). Check the console/log if you can reach it.
4. Delete `csp-mode.txt` afterwards.

### 4. Results

Fill in what you saw. Leave a cell blank if you did not test it.

**Environment (probe block, per folder)**

| Field | A normal | B worktree | C non-git |
|---|---|---|---|
| `runtime.nodeVersion` (U1) | | | |
| `ctx.keys` | | | |
| `ctx.workingDirectory` | | | |
| `git.insideWorkTree` / `isLinkedWorktree` | | | |
| `git.originRedacted` / `parsed` | | | |
| `gh.resolvedPath` / `resolvedViaBarePath` (U2) | | | |
| `gh.authToken.ok` / `stdoutLength` (U2) | | | |
| `gh.releasesApi` (U2) | | | |
| `env.GH_TOKEN_present` / `GITHUB_TOKEN_present` | | | |
| `stateDir.writable` | | | |

**Clipboard and page (folder A)**

| Test | Result |
|---|---|
| 1 writeText: on-page result | |
| 2 clipboard.write html+plain: on-page result | |
| 3 execCommand text: on-page result | |
| 4 execCommand rich: on-page result | |

| Paste target | 1 writeText | 2 html+plain | 3 exec text | 4 exec rich |
|---|---|---|---|---|
| Outlook desktop | | | | |
| Outlook web | | | | |
| Teams | | | | |
| Gmail | | | | |
| Word | | | | |
| Plain editor | | | | |

| Test | Result |
|---|---|
| `mailto:` click | |
| Splitter: mouse (`moveWhileCaptured`, `hasCaptureAfterDown`) | |
| Splitter: touch | |
| Splitter: keyboard (`keyboardMoves`) | |
| `localStorage` visits after reopen / origin changed? | |
| U4 baseline: `violations`, `inlineStyleAttrApplied` | |
| U4 `isTopWindow`, `ancestorOrigins` | |
| U4 `frame-ancestors 'none'` variant renders? | |
| U6: agent called `set_draft`? approval prompt? elapsed ms | |
| U6: `session.send` return (`send` block) | |
| U8: forms that threw / where messages appeared | |
| U8: extension log file location | |
| U7: default panel width | |
| U7: narrowest / widest | |
| U5 (partial): how the canvas was launched, approval prompt, restart needed | |

### 5. Clean up

Delete `~/.copilot/extensions/release-sharer-spike/` (and `csp-mode.txt` with it) and restart the app. The spike folder in the repo is deleted at the P0 gate.

### What the results decide

| Result | Consequence (from PLAN §3.2) |
|---|---|
| `gh` not found from the GUI-launched app | Keep the path probing in §7.3; `gh_missing` state is mandatory |
| Only some clipboard paths work | §11.7 order adjusted to the working ones |
| `frame-ancestors 'none'` breaks the panel | Omit `frame-ancestors` from the CSP |
| Round trip fails | Hide Rewrite; F-16 `cut` or moved to v0.2 (owner decides at the gate) |
| `localStorage` does not survive reopen | No change: prefs are already server-side (§7.4) |

## M1: install check (U5, run on your computer)

Needs the M1 branch pushed to GitHub (the marketplace is read from the repo). Remove the P-0 spike from `~/.copilot/extensions/` first so you only see one canvas. The canvas is a hello-world page: success means the plugin installs, "Release Sharer" is launchable, and the page says "Hello from Release Sharer 0.1.0".

Command forms below are from PLAN §3.1 and the CLI docs; if one is rejected, record the exact error instead of improvising.

### A. Copilot app (Customize > Plugins)

1. Add the marketplace: Customize > Plugins > add marketplace > `mbaic/mb-copilot-release-sharer` (or the full URL `https://github.com/mbaic/mb-copilot-release-sharer`). To test the unmerged branch, use a local clone of the branch instead.
2. Install `release-sharer`. Note whether the app asks you to approve the extension.
3. Note whether a restart or new session was needed, and how the canvas becomes launchable (ask the agent "open the Release Sharer canvas", a menu, a button).
4. Open it. Record what you see.

### B. CLI

1. `copilot plugin marketplace add mbaic/mb-copilot-release-sharer`
2. `copilot plugin install release-sharer@release-sharer`
3. `copilot plugin list --json` (does it list `release-sharer`?)
4. Start a session (`copilot`), run `/clear` or restart if needed, and ask the agent to open the canvas.
5. Optional, from a clone: `npm run smoke` runs the same steps against the local repo with an isolated `COPILOT_HOME`.

### C. VS Code agent session

Same install if the plugin is shared with VS Code; otherwise record that it is not. Then try to open the canvas from an agent session.

### Results (U5)

| Surface | Installed? | Canvas launchable? | How launched | Restart needed? | Page shows hello text? | Notes / exact errors |
|---|---|---|---|---|---|---|
| Copilot app | | | | | | |
| CLI | | | | | | |
| VS Code | | | | | | |

## Later phases

The full manual test script (PLAN §15.3) is recorded here in M9.
