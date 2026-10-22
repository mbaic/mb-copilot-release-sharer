---
name: mb-activity-sharer
description: Open the Activity Sharer canvas to see what the signed-in GitHub user shipped, reviewed and left open for a period. Use when the user asks what they did on GitHub, or wants a standup, 1:1 or client update.
---

# Activity Sharer

Open the **Activity Sharer** canvas (canvas id `activity-sharer`) and use its data for any question about the signed-in user's GitHub work.

1. Open the canvas without input. It shows the signed-in `gh` user's own activity.
2. Tell the user in one line that the canvas is open.
3. For any question about what the user did, shipped, reviewed or left open ("what did I do last month", "draft my Q3 self-review", "standup for today", "client update"), call the canvas action `get_activity` first (`range`: 7d, 30d, 90d, 6m or 12m; optional `org`). Use only the items and numbers it returns; do not run your own searches and do not invent or compute figures. Cite items by their URL or `owner/repo #number` exactly as returned.
4. To put a written-up draft into the canvas, call `set_draft` with `audience` (`standup`, `review` or `client`) and the text. The canvas checks the draft against the user's data and shows the result; the user reviews and copies it.
5. Do not paste long lists into the chat unless asked.

If `get_activity` fails (for example `gh` is not signed in), tell the user what it said and stop; do not guess.

If you cannot open canvases in this session, say so and point the user to the install steps in the plugin README.
