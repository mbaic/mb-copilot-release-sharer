import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize } from "../scripts/spike-activity.mjs";
import { windowsFor } from "../plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/lib/query.mjs";

const w = windowsFor("30d", new Date("2026-10-22T00:00:00Z"));
const group = (name, nodes, totalCount = nodes.length) => ({ repository: { nameWithOwner: name }, contributions: { totalCount, nodes } });
const data = {
  viewer: {
    login: "someone",
    cur: {
      restrictedContributionsCount: 4,
      pullRequestContributionsByRepository: [group("acme/app", [{}, {}]), group("beta/tool", [{}])],
      pullRequestReviewContributionsByRepository: [group("acme/app", [{}], 3)],
      issueContributionsByRepository: [group("beta/tool", [{}])],
    },
    prev: { totalPullRequestContributions: 5, totalPullRequestReviewContributions: 6, totalIssueContributions: 7 },
  },
  merged: { issueCount: 2, nodes: [
    { number: 7, title: "Secret customer rollout", url: "u", createdAt: "a", mergedAt: "b", headRefName: "copilot/fix", author: { login: "Copilot" }, repository: { nameWithOwner: "acme/app" } },
    null,
  ] },
  prevMerged: { issueCount: 3, nodes: [{ createdAt: "a", mergedAt: "b" }] },
  open: { issueCount: 1, nodes: [{ number: 1, headRefName: "claude/x", author: { login: "someone" } }] },
  reviewRequests: { issueCount: 0, nodes: [] },
  rateLimit: { cost: 2, remaining: 4990 },
};

test("summarize reports counts, repos, orgs, rate limit and agent candidates", () => {
  const r = summarize(data, w, { redact: false });
  assert.deepEqual(r.counts.current, { prsOpened: 3, reviews: 3, issues: 1, restrictedContributions: 4 });
  assert.deepEqual(r.counts.previous, { prsOpened: 5, reviews: 6, issues: 7 });
  assert.deepEqual(r.counts.mergedSearch, { issueCount: 2, nodes: 1 });
  assert.equal(r.repoCount, 2);
  assert.equal(r.orgCount, 2);
  assert.deepEqual(r.repos[0], { repo: "acme/app", prs: 2, reviews: 3, issues: 0 });
  assert.deepEqual(r.rateLimit, { cost: 2, remaining: 4990 });
  assert.deepEqual(r.agentCandidates.merged.branchPrefixes, [["copilot", 1]]);
  assert.deepEqual(r.agentCandidates.open.authors, [["someone", 1]]);
  assert.equal(r.sample[0].title, "Secret customer rollout");
});

test("summarize redacts titles, repo names and login by default", () => {
  const out = JSON.stringify(summarize(data, w));
  assert.ok(!out.includes("Secret customer rollout"));
  assert.ok(!out.includes("acme"));
  assert.ok(!out.includes("someone"));
  assert.ok(out.includes("<23 chars>"));
});

test("summarize copes with an empty or partial response", () => {
  const r = summarize({}, w);
  assert.equal(r.repoCount, 0);
  assert.equal(r.counts.current.prsOpened, 0);
  assert.equal(r.counts.mergedSearch.issueCount, null);
  assert.deepEqual(r.sample, []);
});
