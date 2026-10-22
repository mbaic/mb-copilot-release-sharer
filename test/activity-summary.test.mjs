import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDays, summarize } from "../plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/lib/summary.mjs";
import { aggregate } from "../plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/lib/aggregate.mjs";
import { NOW, data, model, windows } from "./activity-helpers.mjs";

test("golden: normal period uses the first two available facts", () => {
  assert.deepEqual(summarize(model()), {
    headline: "You merged 11 pull requests in 3 repositories and gave 9 reviews for 6 people.",
    support: "Merged PRs are up from 9. Your PRs merged faster (median 1.1 days, was 7).",
  });
});

test("golden: a decrease is stated neutrally", () => {
  const d = data();
  d.prevMerged.issueCount = 14;
  d.prevMerged.nodes = d.prevMerged.nodes.slice(0, 9);
  // 14 > 9 listed nodes: the previous count is a known cap, so the merged-delta fact is skipped, not guessed.
  const capped = summarize(model({}, d));
  assert.ok(!/up from|down from/.test(capped.support));
  const d2 = data();
  d2.prevMerged.nodes = [...d2.prevMerged.nodes, ...d2.prevMerged.nodes.slice(0, 5)];
  d2.prevMerged.issueCount = 14;
  assert.match(summarize(model({}, d2)).support, /^Merged PRs are down from 14\./);
});

test("golden: same count and slower merge", () => {
  const d = data();
  d.prevMerged.nodes = Array.from({ length: 11 }, () => ({ createdAt: "2026-09-01T00:00:00Z", mergedAt: "2026-09-01T12:00:00Z", repository: { nameWithOwner: "a/b" } }));
  d.prevMerged.issueCount = 11;
  const s = summarize(model({}, d));
  assert.match(s.support, /^Merged PRs are the same as the previous period \(11\)\. Median time to merge is 1\.1 days, was 0\.5\.$/);
});

test("golden: sub-day durations use hours", () => {
  assert.equal(formatDays(0.5), "12 hours");
  assert.equal(formatDays(0.01), "1 hour");
  assert.equal(formatDays(1), "1 day");
  assert.equal(formatDays(2.5), "2.5 days");
});

test("golden: quiet period names what was done", () => {
  const d = data();
  d.merged = { issueCount: 0, nodes: [] };
  d.prevMerged = { issueCount: 0, nodes: [] };
  d.viewer.cur.pullRequestReviewContributionsByRepository = [];
  assert.equal(summarize(model({}, d)).headline, "No PRs merged or reviews given. You opened 12 pull requests and 3 issues.");
});

test("golden: reviews only, merged only, single items", () => {
  const d = data();
  d.merged = { issueCount: 0, nodes: [] };
  assert.equal(summarize(model({}, d)).headline, "You gave 9 reviews for 6 people.");
  const e = data();
  e.viewer.cur.pullRequestReviewContributionsByRepository = [];
  assert.equal(summarize(model({}, e)).headline, "You merged 11 pull requests in 3 repositories.");
  const one = data();
  one.merged.nodes = one.merged.nodes.slice(0, 1);
  one.merged.issueCount = 1;
  one.viewer.cur.pullRequestReviewContributionsByRepository = one.viewer.cur.pullRequestReviewContributionsByRepository.slice(0, 1);
  one.viewer.cur.pullRequestReviewContributionsByRepository[0].contributions = { totalCount: 1, nodes: one.viewer.cur.pullRequestReviewContributionsByRepository[0].contributions.nodes.slice(0, 1) };
  assert.equal(summarize(model({}, one)).headline, "You merged 1 pull request in 1 repository and gave 1 review for 1 person.");
});

test("golden: empty period", () => {
  const s = summarize(aggregate({}, windows(), { now: NOW }));
  assert.deepEqual(s, { headline: "No PRs, reviews or issues in this period.", support: "" });
});

test("conflict: only two facts are chosen, in priority order, and stale PRs come last", () => {
  const m = model();
  const many = summarize(m).support.split(/(?<=\.)\s/);
  assert.equal(many.length, 2);
  const d = data();
  d.prevMerged.nodes = [];
  d.prevMerged.issueCount = 0;
  d.viewer.cur.pullRequestReviewContributionsByRepository = [];
  d.merged.nodes = d.merged.nodes.slice(0, 2);
  d.merged.issueCount = 2;
  // merged delta (up from 0) then top repo; the stale-PR fact is the fifth candidate and is dropped.
  const s = summarize(model({}, d));
  assert.match(s.support, /^Merged PRs are up from 0\./);
  assert.ok(!/older than/.test(s.support));
});

test("every number in the summary is a shown figure", async () => {
  const { shownFigures } = await import("../plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/lib/evidence.mjs");
  const m = model();
  const text = Object.values(summarize(m)).join(" ");
  const shown = shownFigures(m);
  for (const n of text.match(/\d+(?:\.\d+)?/g)) assert.ok(shown.has(String(Number(n))), `${n} is not a shown figure`);
});

test("org-filtered summary does not claim comparisons it cannot make", () => {
  const s = summarize(model({ orgs: ["contoso"] }));
  assert.match(s.headline, /^You merged 6 pull requests in 2 repositories/);
});
