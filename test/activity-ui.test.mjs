import { test } from "node:test";
import assert from "node:assert/strict";
import { ageLabel, checkView, deltaView, describeError, niceTicks, safeHref, shortDate, windowLabel } from "../plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/ui/logic.js";

test("shortDate and windowLabel", () => {
  assert.equal(shortDate("2026-10-09"), "Oct 9");
  assert.equal(shortDate("2026-10-09T12:00:00Z"), "Oct 9");
  assert.equal(shortDate("nope"), "");
  assert.equal(windowLabel({ from: "2026-09-22T12:00:00Z", to: "2026-10-22T12:00:00Z" }), "Sep 22 – Oct 22, 2026");
  assert.equal(windowLabel({ from: "2025-10-22T12:00:00Z", to: "2026-10-22T12:00:00Z" }), "Oct 22, 2025 – Oct 22, 2026");
});

test("deltaView: up, down, same and nothing to compare", () => {
  assert.deepEqual(deltaView(11, 9), { cls: "up", text: "▲ 2 vs previous" });
  assert.deepEqual(deltaView(9, 12), { cls: "down", text: "▼ 3 vs previous" });
  assert.deepEqual(deltaView(3, 3), { cls: "same", text: "● same as previous" });
  assert.equal(deltaView(3, null), null);
});

test("ageLabel", () => {
  assert.equal(ageLabel(0), "today");
  assert.equal(ageLabel(1), "1 day");
  assert.equal(ageLabel(19), "19 days");
});

test("safeHref allows http(s) only", () => {
  assert.equal(safeHref("https://github.com/a/b"), "https://github.com/a/b");
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "not a url", undefined]) assert.equal(safeHref(bad), null, String(bad));
});

test("niceTicks gives integer steps", () => {
  assert.deepEqual(niceTicks(6), [0, 2, 4, 6]);
  assert.deepEqual(niceTicks(1), [0, 1, 2, 3]);
  assert.deepEqual(niceTicks(7), [0, 3, 6, 9]);
});

test("checkView: pass and flagged", () => {
  assert.equal(checkView({ ok: true, issues: [] }).cls, "ok");
  const bad = checkView({ ok: false, issues: [{ text: "37", message: "not shown" }] });
  assert.equal(bad.cls, "bad");
  assert.match(bad.title, /1 item doesn't match/);
  assert.deepEqual(bad.items, ["37: not shown"]);
});

test("describeError maps gh states to panel content", () => {
  assert.equal(describeError({ code: "gh_missing" }).link.href, "https://cli.github.com");
  assert.equal(describeError({ code: "gh_not_authenticated" }).command, "gh auth login");
  assert.match(describeError({ code: "forbidden" }).detail, /gh auth refresh/);
  assert.equal(describeError({ code: "network" }).title, "Could not reach GitHub");
  assert.equal(describeError({ code: "x", message: "Odd" }).title, "Odd");
  assert.equal(describeError(undefined).title, "Something went wrong");
});
