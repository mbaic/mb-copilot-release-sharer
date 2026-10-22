import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, median } from "../plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/lib/aggregate.mjs";
import { NOW, data, model, windows } from "./activity-helpers.mjs";

test("median handles empty, odd and even lists", () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test("tiles, deltas and sub-counts for the fixture", () => {
  const m = model();
  assert.deepEqual(Object.fromEntries(Object.entries(m.tiles).map(([k, v]) => [k, [v.count, v.prev, v.items.length]])),
    { merged: [11, 9, 11], opened: [12, 10, 12], reviews: [9, 12, 9], issues: [3, 3, 3] });
  assert.equal(m.tiles.opened.stillOpen, 3);
  assert.equal(m.tiles.reviews.people, 6);
  assert.equal(m.tiles.issues.closed, 2);
  assert.equal(m.login, "mbaic");
  assert.deepEqual(m.orgs, ["contoso", "mbaic"]);
});

test("merged includes PRs opened before the window and is sorted newest first", () => {
  const m = model();
  const rework = m.tiles.merged.items.find((i) => i.number === 208);
  assert.equal(rework.date, "2026-10-13"); // opened 2026-10-01, before... merged inside the window
  assert.equal(m.tiles.merged.items[0].number, 41);
  const dates = m.tiles.merged.items.map((i) => i.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
});

test("insights: median time to merge, reviewed PRs that shipped, top repo", () => {
  const m = model();
  assert.equal(m.insights.medianMergeDays, 1.1);
  assert.equal(m.insights.prevMedianMergeDays, 7);
  assert.deepEqual(m.insights.reviewedShipped, { shipped: 7, total: 9 });
  assert.deepEqual(m.insights.topRepo, { repo: "contoso/erp-extensions", share: 39 });
  assert.equal(m.repoCountMerged, 3);
});

test("open loops carry ages and the stale flag (> 7 days)", () => {
  const m = model();
  assert.deepEqual(m.openPrs.map((p) => [p.number, p.ageDays, p.stale, p.draft]), [[198, 19, true, false], [44, 5, false, true], [61, 2, false, false]]);
  assert.deepEqual(m.reviewRequests.map((p) => [p.number, p.author, p.ageDays]), [[215, "ana-k", 2], [99, "jonas-p", 0]]);
});

test("the org filter narrows every list and drops deltas it cannot compute", () => {
  const m = model({ orgs: ["mbaic"] });
  assert.equal(m.tiles.merged.count, 5);
  assert.ok(m.tiles.merged.items.every((i) => i.repo.startsWith("mbaic/")));
  assert.equal(m.tiles.opened.prev, null);
  assert.equal(m.tiles.reviews.prev, null);
  assert.equal(m.tiles.merged.prev, 3); // previous merged nodes are filtered too
  assert.deepEqual(m.repos.map((r) => r.repo), ["mbaic/mb-copilot-release-sharer"]);
  assert.deepEqual(m.orgs, ["contoso", "mbaic"]); // the org list does not shrink
  assert.ok(m.openPrs.every((p) => p.repo.startsWith("mbaic/")));
});

test("several organizations: selecting all of them is the same as no filter; a subset narrows", () => {
  const all = model({ orgs: ["mbaic", "contoso"] });
  assert.equal(all.selectedOrgs.length, 0);
  assert.equal(all.tiles.merged.count, 11);
  assert.equal(all.tiles.opened.prev, 10); // deltas stay when nothing is filtered
  const some = model({ orgs: ["contoso"] });
  assert.deepEqual(some.selectedOrgs, ["contoso"]);
  assert.equal(some.tiles.merged.count, 6);
  assert.equal(some.tiles.reviews.count, 8);
  assert.ok(some.repos.every((r) => r.owner === "contoso"));
  assert.equal(model({ orgs: [] }).selectedOrgs.length, 0);
});

test("an organization with no data in the selection yields empty lists, not an error", () => {
  const m = model({ orgs: ["nobody"] });
  assert.equal(m.tiles.merged.count, 0);
  assert.deepEqual(m.repos, []);
  assert.deepEqual(m.selectedOrgs, ["nobody"]);
});

test("chart buckets: weekly for 30 days, last bucket partial, nothing lost", () => {
  const m = model();
  assert.equal(m.chart.unit, "week");
  assert.equal(m.chart.buckets.length, 5);
  assert.equal(m.chart.buckets.at(-1).days, 2);
  assert.equal(m.chart.buckets.reduce((n, b) => n + b.merged, 0), 11);
  assert.equal(m.chart.buckets.reduce((n, b) => n + b.reviews, 0), 9);
});

test("chart unit follows the range: day, week, month", () => {
  assert.equal(model({}, data(), "7d").chart.unit, "day");
  assert.equal(model({}, data(), "7d").chart.buckets.length, 7);
  assert.equal(model({}, data(), "90d").chart.unit, "week");
  const y = model({}, data(), "12m");
  assert.equal(y.chart.unit, "month");
  assert.equal(y.chart.buckets.length, 13);
});

test("agent tagging is off by default and only appears when enabled", () => {
  const off = model();
  assert.equal(off.insights.agentMerged, null);
  assert.ok(off.tiles.merged.items.every((i) => i.agent === null));
  const on = model({ agent: true });
  assert.deepEqual(on.insights.agentMerged, { count: 5, total: 11, names: ["Claude", "Copilot"] });
  assert.equal(on.tiles.merged.items.find((i) => i.number === 38).agent, "Copilot");
  assert.equal(on.openPrs.find((p) => p.number === 61).agent, "Claude");
});

test("empty period and missing data do not throw", () => {
  const m = aggregate({}, windows(), { now: NOW });
  assert.equal(m.tiles.merged.count, 0);
  assert.equal(m.insights.medianMergeDays, null);
  assert.equal(m.insights.topRepo, null);
  assert.deepEqual(m.repos, []);
  assert.equal(m.chart.buckets.reduce((n, b) => n + b.merged, 0), 0);
});

test("caps are reported when totals exceed the listed nodes", () => {
  const d = data();
  d.merged.issueCount = 140;
  d.open.issueCount = 80;
  d.viewer.cur.pullRequestContributionsByRepository[0].contributions.totalCount = 150;
  d.prevMerged.issueCount = 120;
  const m = aggregate(d, windows(), { now: NOW });
  assert.equal(m.limits.merged, true);
  assert.equal(m.limits.open, true);
  assert.equal(m.limits.perRepo, true);
  assert.equal(m.limits.prevMerged, true);
  assert.equal(m.tiles.merged.count, 140); // GitHub's own total, not the listed 11
  assert.equal(m.limits.restrictedContributions, 9);
});

test("private-only activity: restricted count and no itemised rows", () => {
  const d = { viewer: { login: "mbaic", cur: { restrictedContributionsCount: 12 }, prev: {} } };
  const m = aggregate(d, windows(), { now: NOW });
  assert.equal(m.limits.restrictedContributions, 12);
  assert.equal(m.tiles.opened.count, 0);
});

test("multi-org: reviews and issues are grouped per repository", () => {
  const m = model();
  const erp = m.repos.find((r) => r.repo === "contoso/erp-extensions");
  assert.deepEqual([erp.merged, erp.reviews, erp.issues], [4, 4, 1]);
});

test("openCount is GitHub's total unfiltered and the listed count when filtered", () => {
  const m = model();
  assert.equal(m.openCount, 3);
  const d = data();
  d.open.issueCount = 80;
  assert.equal(model({}, d).openCount, 80);
  assert.equal(model({ orgs: ["mbaic"] }, d).openCount, 1);
});
