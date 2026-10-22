# Changelog

## 0.2.2 (unreleased)

- organization filter is now a multi-select: tick the organizations (or your own account) to include; at least one stays ticked, "Select all" resets it, Escape or an outside click closes the menu. Ticking every organization is the same as no filter, so comparisons with the previous window stay. The agent action `get_activity` takes `orgs` (a list) as well as the single `org`.
- the "Open PRs now" tile no longer repeats "right now" under its count.

## 0.2.1 (unreleased)

- the second tile is now "Open PRs now" (your real open PRs, with how many are older than 7 days) instead of "PRs opened in the period", which overlapped with PRs merged and miscounted "still open". Same source as the "Your open PRs" list; no comparison with the previous window because it is the current state.

## 0.2.0 (unreleased)

- the canvas: header with range (7 days, 30 days, quarter, 6 months, 12 months, rolling windows) and organization filter; factual summary; tiles for PRs merged, PRs opened, reviews given and issues opened, each with its change against the previous window and a list of linked items; insights (median time to merge, reviewed PRs that shipped, top repository); open loops (your open PRs with age, review requests waiting on you); per-day, per-week or per-30-days chart; repository table; limits shown (private contributions, 100-item caps, SSO).
- "Write it up": Standup, 1:1 or self-review and Client update. The agent drafts from the canvas data, the canvas checks every link, reference, date and number in the draft against your items and flags mismatches before you copy as text or Markdown.
- agent actions `get_activity` and `set_draft`; skill `mb-activity-sharer` tells the agent to use `get_activity` for any "what did I do" question.
- one GraphQL request per range through `gh`, cached per range; Refresh refetches.
- agent-assisted tagging is built but switched off until spike check S7 is reported ([docs/TESTING.md](../../docs/TESTING.md)).
- all platform checks are unverified until run in the real app (S1-S10, A-checks).

## 0.1.0 (unreleased)

- scaffold: plugin and marketplace manifests, placeholder canvas, start skill `mb-activity-sharer`.
- spike script `scripts/spike-activity.mjs` and query builders for the one-request data layer. Platform checks S1-S10 are unverified ([docs/TESTING.md](../../docs/TESTING.md)).
