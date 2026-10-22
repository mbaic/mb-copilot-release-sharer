// Activity Sharer UI in a browser with made-up data (test/fixtures/activity.response.json); no GitHub, no agent.
//   npm run dev:activity [-- --error=gh_missing|gh_not_authenticated|rate_limited|network] [--partial] [--bad-draft] [--no-writeup]
// "Write it up" answers with a canned draft; --bad-draft plants a wrong number and a foreign link to show the evidence check.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startInstanceServer } from "../plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/src/server.mjs";
import { makeError } from "../plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/src/errors.mjs";
import { windowsFor } from "../plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/lib/query.mjs";

const extDir = fileURLToPath(new URL("../plugins/activity-sharer/com.github.copilot/extensions/activity-sharer", import.meta.url));
const { data } = JSON.parse(readFileSync(fileURLToPath(new URL("../test/fixtures/activity.response.json", import.meta.url)), "utf8"));
const flags = new Set(process.argv.slice(2));
const error = process.argv.find((a) => a.startsWith("--error="))?.slice(8);
const NOW = new Date("2026-10-22T12:00:00Z");

const DRAFTS = {
  standup: "Done: merged 11 pull requests, including https://github.com/mbaic/mb-copilot-release-sharer/pull/41.\nNext: finish contoso/bc-agents #61 and review contoso/erp-extensions #215.\nBlocked: nothing in the data.",
  review: "I merged 11 pull requests across 3 repositories and gave 9 reviews for 6 people. My median time to merge was 1.1 days, down from 7.",
  client: "This period we delivered 11 improvements across three systems, including a clearer sign-in error message and faster, more reliable agent tools.",
};

let server;
server = await startInstanceServer({
  extDir,
  version: "dev",
  loadActivity: async ({ range }) => {
    if (error) return { error: makeError(error) };
    return { data, windows: windowsFor(range, NOW), fetchedAt: NOW.toISOString(), ...(flags.has("--partial") ? { partial: [{ kind: "sso", message: "Resource protected by organization SAML enforcement." }] } : {}) };
  },
  writeup: async ({ audience }) => {
    if (flags.has("--no-writeup")) throw new Error("no agent in dev mode");
    const text = flags.has("--bad-draft") ? `${DRAFTS[audience]}\nAlso 14 reviews, see https://github.com/someone-else/repo/pull/9 and #999.` : DRAFTS[audience];
    setTimeout(() => server.broadcast("draft", { audience, text }), 700);
  },
  log: { error: (m) => console.error(m) },
});
console.log(`Activity Sharer dev UI: ${server.url}`);
