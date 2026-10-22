import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIVITY_QUERY, RANGES, activityVariables, ghGraphqlArgs, isIsoUtc, isValidLogin, searchStrings, windowsFor } from "../plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/lib/query.mjs";
import { agentCandidates, branchPrefix, tally } from "../plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/lib/agent.mjs";

const NOW = new Date("2026-10-22T12:34:56.789Z");

test("windowsFor builds a rolling current window and an equal previous window", () => {
  const w = windowsFor("30d", NOW);
  assert.deepEqual(w.cur, { from: "2026-09-22T12:34:56Z", to: "2026-10-22T12:34:56Z" });
  assert.deepEqual(w.prev, { from: "2026-08-23T12:34:56Z", to: "2026-09-22T12:34:56Z" });
  assert.equal(w.days, 30);
});

test("every range key maps to a window; 12m stays within one year", () => {
  for (const key of Object.keys(RANGES)) {
    const w = windowsFor(key, NOW);
    assert.equal((Date.parse(w.cur.to) - Date.parse(w.cur.from)) / 86_400_000, RANGES[key]);
    assert.equal(w.prev.to, w.cur.from);
  }
  assert.ok(RANGES["12m"] <= 365);
});

test("an unknown range is rejected", () => {
  assert.throws(() => windowsFor("month", NOW), /unknown range/);
});

test("searchStrings uses merged:, not a created-in-window rule", () => {
  const s = searchStrings("octo-cat", windowsFor("7d", NOW));
  assert.equal(s.qMerged, "is:pr author:octo-cat merged:2026-10-15T12:34:56Z..2026-10-22T12:34:56Z");
  assert.equal(s.qPrevMerged, "is:pr author:octo-cat merged:2026-10-08T12:34:56Z..2026-10-15T12:34:56Z");
  assert.equal(s.qOpen, "is:pr is:open author:octo-cat archived:false");
  assert.equal(s.qReq, "is:pr is:open review-requested:octo-cat archived:false");
});

test("logins and dates are validated before they reach a search string", () => {
  for (const bad of ["", "a b", "x merged:2020-01-01..2020-02-02", "-lead", "a".repeat(40), "a;b", null, 5]) {
    assert.equal(isValidLogin(bad), false, String(bad));
    assert.throws(() => searchStrings(bad, windowsFor("7d", NOW)), /invalid login/);
  }
  assert.equal(isValidLogin("mbaic"), true);
  assert.equal(isIsoUtc("2026-10-22T12:34:56Z"), true);
  assert.equal(isIsoUtc("2026-10-22"), false);
  assert.equal(isIsoUtc("2026-13-45T00:00:00Z"), false);
  const w = windowsFor("7d", NOW);
  assert.throws(() => searchStrings("ok", { ...w, cur: { ...w.cur, from: "yesterday" } }), /invalid date/);
});

test("ghGraphqlArgs is an argument array with -f variables only (no shell, no -F coercion)", () => {
  const args = ghGraphqlArgs("query { x }", { qMerged: "is:pr author:a", n: "@file" });
  assert.deepEqual(args, ["api", "graphql", "-f", "query=query { x }", "-f", "qMerged=is:pr author:a", "-f", "n=@file"]);
  assert.ok(!args.includes("-F"));
});

test("activityVariables covers every variable the query declares", () => {
  const vars = activityVariables("mbaic", windowsFor("30d", NOW));
  const declared = [...ACTIVITY_QUERY.matchAll(/\$(\w+):/g)].map((m) => m[1]);
  assert.deepEqual(Object.keys(vars).sort(), [...new Set(declared)].sort());
});

test("agent candidates: branch prefixes and author tallies", () => {
  assert.equal(branchPrefix("copilot/fix-123"), "copilot");
  assert.equal(branchPrefix("Claude/Thing"), "claude");
  assert.equal(branchPrefix("main"), null);
  assert.equal(branchPrefix("/x"), null);
  assert.equal(branchPrefix(undefined), null);
  assert.deepEqual(tally(["b", "a", "b", null]), [["b", 2], ["a", 1]]);
  const c = agentCandidates([
    { headRefName: "copilot/a", author: { login: "Copilot" } },
    { headRefName: "claude/b", author: { login: "me" } },
    { headRefName: "feat/c", author: { login: "me" } },
    { headRefName: "plain", author: null },
  ]);
  assert.deepEqual(c.branchPrefixes, [["claude", 1], ["copilot", 1], ["feat", 1]]);
  assert.deepEqual(c.authors, [["me", 2], ["Copilot", 1]]);
});
