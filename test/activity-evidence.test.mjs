import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDraft, knownUrls, linkify, shownFigures, toMarkdown } from "../plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/lib/evidence.mjs";
import { model } from "./activity-helpers.mjs";

const m = model();
const R41 = "https://github.com/mbaic/mb-copilot-release-sharer/pull/41";
const kinds = (text) => checkDraft(text, m).issues.map((i) => `${i.kind}:${i.text}`);

test("a clean draft passes", () => {
  const text = `Merged 11 pull requests, up from 9, in 3 repositories, for example ${R41}. Median time to merge was 1.1 days, down from 7. Reviewed 9 PRs for 6 people; 7 of 9 have shipped. Work on contoso/bc-agents #61 is open since Oct 20, 2026.`;
  assert.deepEqual(checkDraft(text, m), { ok: true, issues: [] });
});

test("a wrong number is flagged", () => {
  assert.deepEqual(kinds("I merged 37 pull requests."), ["number:37"]);
});

test("a decimal is checked as a whole", () => {
  assert.deepEqual(kinds("Median 1.1 days, was 7."), []);
  assert.deepEqual(kinds("Median 1.7 days."), ["number:1.7"]);
});

test("a foreign link is flagged, a known item or repo link passes", () => {
  assert.deepEqual(kinds("See https://github.com/other/thing/pull/41."), ["link:https://github.com/other/thing/pull/41"]);
  assert.deepEqual(kinds(`See ${R41}, https://github.com/contoso/erp-extensions.`), []);
  assert.deepEqual(kinds("See https://evil.example/x?pull=41"), ["link:https://evil.example/x?pull=41"]);
});

test("#n and owner/repo #n references must exist", () => {
  assert.deepEqual(kinds("Shipped #41 and contoso/erp-extensions #212."), []);
  assert.deepEqual(kinds("Shipped #999."), ["ref:#999"]);
  assert.deepEqual(kinds("Shipped contoso/erp-extensions #41."), ["ref:contoso/erp-extensions #41"]); // #41 exists, but in another repo
});

test("numbers inside links and refs are not double-counted", () => {
  assert.deepEqual(kinds(`${R41} and mbaic/mb-copilot-release-sharer #41`), []);
});

test("dates are checked as dates: known ones pass, unknown ones are flagged", () => {
  assert.deepEqual(kinds("Done on Oct 20 and 14 Oct and 2026-10-03."), []);
  assert.deepEqual(kinds("Done on Oct 21."), ["date:Oct 21"]);
  assert.deepEqual(kinds("About 14 reviews."), ["number:14"]);
});

test("versions, quarters and words next to digits are not numbers; 1:1 is ignored", () => {
  assert.deepEqual(kinds("Q3 recap for the 1:1, shipped v0.2.2"), []);
});

test("the same wrong number is reported once", () => {
  assert.deepEqual(kinds("37 here and 37 there"), ["number:37"]);
});

test("shown figures include counts, deltas, ages, shares and repo rows", () => {
  const f = shownFigures(m);
  for (const n of ["11", "9", "2", "3", "7", "39", "19", "1.1", "2026", "30"]) assert.ok(f.has(n), n);
  assert.ok(!f.has("37"));
});

test("known URLs cover items and repositories only", () => {
  const urls = knownUrls(m);
  assert.ok(urls.has(R41));
  assert.ok(urls.has("https://github.com/contoso/docs"));
  assert.ok(!urls.has("https://github.com/mbaic"));
});

test("linkify only links known URLs and refs; trailing punctuation stays outside the link", () => {
  const segs = linkify(`See ${R41}. Also https://evil.example/a and contoso/bc-agents #61, plus mbaic/nope #1.`, m);
  const links = segs.filter((s) => s.href);
  assert.deepEqual(links.map((s) => s.href), [R41, "https://github.com/contoso/bc-agents/pull/61"]);
  assert.equal(segs.map((s) => s.text).join(""), `See ${R41}. Also https://evil.example/a and contoso/bc-agents #61, plus mbaic/nope #1.`);
  assert.ok(segs.some((s) => s.text === "."));
});

test("toMarkdown turns known refs into links and leaves the rest as written", () => {
  assert.equal(toMarkdown("Fixed contoso/bc-agents #61 and nope/x #1.", m), "Fixed [contoso/bc-agents #61](https://github.com/contoso/bc-agents/pull/61) and nope/x #1.");
});

test("an empty or missing draft passes trivially", () => {
  assert.equal(checkDraft("", m).ok, true);
  assert.equal(checkDraft(undefined, m).ok, true);
});
