# Activity Sharer

Canvas for the GitHub Copilot app: what you shipped, reviewed and left open on GitHub across every repo and org for a chosen period, with an evidence-checked write-up for standups, 1:1s and client updates.

- Tiles for PRs merged, open PRs now, reviews given and issues opened; merged, reviews and issues show their change against the previous window of equal length. Select a tile to list its items.
- Insights, open loops (your open PRs with age, review requests waiting on you), a chart and a repository table. Organization filter, no refetch.
- "Write it up": the agent drafts from the canvas data; the canvas checks every link, reference, date and number against your items and flags mismatches before you copy.
- Ask in chat: the agent action `get_activity` returns verified data for any "what did I do" question.
- Reads your own activity through `gh` only (`gh auth login`); stores nothing; no telemetry.

**Status: 0.2.2.** Built and tested against made-up data; platform behavior is not verified in the real app yet ([docs/TESTING.md](../../docs/TESTING.md), [docs/FINDINGS.md](../../docs/FINDINGS.md)). Install and docs: [main README](../../README.md). Extensions run with your user privileges; review the source before installing.
