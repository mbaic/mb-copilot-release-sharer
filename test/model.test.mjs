import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBody, buildModel, cleanText, contributorsLine } from "../plugins/release-sharer/com.github.copilot/extensions/release-sharer/lib/model.mjs";
import { fixture, toRelease, rel } from "./helpers.mjs";

const fx = () => buildModel(toRelease(fixture("v2.4.1.release.json")));
const titles = (m) => m.sections.map((s) => s.title);

test("fixture: sections, items, authors, refs", () => {
  const m = fx();
  assert.deepEqual(titles(m), ["Features", "Fixes", "New Contributors"]);
  assert.equal(m.sections[0].items[0].text, "Posting preview now respects dimension filters by @alice in https://github.com/acme/bc-app/pull/482");
  assert.deepEqual(m.sections[0].items[0].authors, ["alice"]);
  assert.deepEqual(m.sections[0].items[0].refs, ["#482"]);
  assert.deepEqual(m.newContributors, ["carla"]);
  assert.deepEqual(m.contributors, ["alice", "bjorn", "carla"]);
  assert.equal(m.hasStructure, true);
  assert.equal(m.truncated, false);
});

test("fixture: title, date, label, url", () => {
  const m = fx();
  assert.equal(m.tag, "v2.4.1");
  assert.equal(m.title, "Posting preview and dimension fixes");
  assert.equal(m.date, "2026-10-09T08:00:00Z");
  assert.equal(m.dateLabel, "9 Oct 2026");
  assert.equal(m.url, "https://github.com/acme/bc-app/releases/tag/v2.4.1");
});

test("What's Changed is renamed to Changes (case, apostrophe variants); empty sections dropped", () => {
  for (const h of ["What's Changed", "what’s changed", "WHATS CHANGED"]) {
    const { sections } = parseBody(`## ${h}\n* a`);
    assert.deepEqual(sections.map((s) => s.title), ["Changes"], h);
  }
  assert.deepEqual(titles(buildModel(rel("## What's Changed\n### Fixes\n* a"))), ["Fixes"]);
});

test("content before the first heading goes to Notes; Notes omitted when empty", () => {
  const m = buildModel(rel("Intro text\n\n## Fixes\n* a"));
  assert.deepEqual(titles(m), ["Notes", "Fixes"]);
  assert.deepEqual(m.sections[0].paragraphs, ["Intro text"]);
  assert.deepEqual(titles(buildModel(rel("## Fixes\n* a"))), ["Fixes"]);
});

test("bullet markers, continuation lines and one nesting level", () => {
  const m = buildModel(rel("## A\n- one\n+ two\n* three wraps\n  onto the next line\n* parent\n  * child\n    * grandchild\n  * child two"));
  const items = m.sections[0].items.map((i) => i.text);
  assert.deepEqual(items, ["one", "two", "three wraps onto the next line", "parent\n  - child\n  - grandchild\n  - child two"]);
});

test("fenced code is kept verbatim as one paragraph and never parsed", () => {
  const body = "## A\n```js\n# not a heading\n* not an item by @x in https://h/pull/1\n```\n* real";
  const s = buildModel(rel(body)).sections[0];
  assert.deepEqual(s.paragraphs, ["```js\n# not a heading\n* not an item by @x in https://h/pull/1\n```"]);
  assert.deepEqual(s.items.map((i) => i.text), ["real"]);
  assert.deepEqual(parseBody("~~~\n* x\n~~~").sections[0].paragraphs, ["~~~\n* x\n~~~"]);
  assert.equal(parseBody("```\nunterminated\n* x").sections[0].paragraphs.length, 1);
});

test("images become alt text or vanish; tables stay as raw paragraph text", () => {
  const m = buildModel(rel("## A\n* ![logo](https://x/y.png) added\n* ![](https://x/z.png)\n\n| a | b |\n|---|---|\n| 1 | 2 |"));
  assert.deepEqual(m.sections[0].items.map((i) => i.text), ["logo added"]);
  assert.deepEqual(m.sections[0].paragraphs, ["| a | b |\n|---|---|\n| 1 | 2 |"]);
});

test("attribution, (#n) and bot extraction", () => {
  const m = buildModel(rel("## A\n* Bump x by @dependabot[bot] in https://github.com/o/r/pull/9\n* Fix y (#12)\n* Fix z (#13) by @bob in https://github.com/o/r/pull/14\n* Plain"));
  const [a, b, c, d] = m.sections[0].items;
  assert.deepEqual([a.authors, a.refs], [["dependabot[bot]"], ["#9"]]);
  assert.deepEqual([b.authors, b.refs], [[], ["#12"]]);
  assert.deepEqual([c.authors, c.refs], [["bob"], ["#14", "#13"]]);
  assert.deepEqual([d.authors, d.refs], [[], []]);
  assert.deepEqual(m.contributors, ["bob"]); // bots excluded
});

test("nested items contribute their authors", () => {
  const m = buildModel(rel("## A\n* parent\n  * child by @zed in https://github.com/o/r/pull/3"));
  assert.deepEqual(m.sections[0].items[0].authors, ["zed"]);
});

test("Full Changelog line is removed (bold or not)", () => {
  for (const line of ["**Full Changelog**: https://x/compare/a...b", "Full Changelog: https://x"]) {
    assert.deepEqual(buildModel(rel(`## A\n* a\n\n${line}`)).sections[0].paragraphs, []);
  }
});

test("contributors: unique, case-insensitive sort, bots and ghost excluded, new contributors merged", () => {
  const body = "## A\n* x by @Bjorn in https://h/pull/1\n* y by @alice in https://h/pull/2\n* z by @bjorn in https://h/pull/3\n* w by @ghost in https://h/pull/4\n* v by @renovate[bot] in https://h/pull/5\n\n## New Contributors\n* @carla made their first contribution in https://h/pull/6\n* @Alice made their first contribution in https://h/pull/2";
  assert.deepEqual(buildModel(rel(body)).contributors, ["alice", "Bjorn", "carla"]);
});

test("contributorsLine follows the clean toggle", () => {
  const m = fx();
  assert.equal(contributorsLine(m, { clean: true }), "Contributors: alice, bjorn, carla");
  assert.equal(contributorsLine(m, { clean: false }), "Contributors: @alice, @bjorn, @carla");
  assert.equal(contributorsLine(buildModel(rel("")), { clean: true }), "");
});

test("free-form body becomes one Notes section of paragraphs", () => {
  const m = buildModel(rel("Big release.\n\n## Overview\nSome more text.\n\n```\ncode\n```"));
  assert.equal(m.hasStructure, false);
  assert.deepEqual(m.sections, [{ title: "Notes", items: [], paragraphs: ["Big release.", "Overview", "Some more text.", "```\ncode\n```"] }]);
});

test("empty, null, undefined and whitespace bodies give no sections", () => {
  for (const body of ["", null, undefined, "  \n \n"]) {
    const m = buildModel(rel(body));
    assert.deepEqual(m.sections, []);
    assert.equal(m.hasStructure, false);
    assert.deepEqual(m.contributors, []);
  }
});

test("CRLF and lone CR are normalized; HTML comments and trailing whitespace stripped", () => {
  const m = buildModel(rel("## A  \r\n* one <!-- hidden\r\nstill hidden -->two   \r\n* three\r\n<!-- trailing, unclosed"));
  assert.deepEqual(m.sections[0].items.map((i) => i.text), ["one two", "three"]);
  assert.deepEqual(parseBody("## A\r* x").sections[0].items.map((i) => i.text), ["x"]);
});

test("bodies over 200 KB are parsed partly and flagged", () => {
  const body = "## A\n" + "* item line that is fairly long to pad out the body\n".repeat(5000);
  assert.ok(body.length > 200 * 1024);
  const m = buildModel(rel(body));
  assert.equal(m.truncated, true);
  assert.ok(m.sections[0].items.length > 3000 && m.sections[0].items.length < 5000);
  assert.ok(m.sections[0].items.every((i) => i.text.startsWith("item line")));
  assert.equal(buildModel(rel("## A\n* x")).truncated, false);
});

test("title: null when name is empty or equals the tag (case-insensitive)", () => {
  assert.equal(buildModel(rel("", { name: null })).title, null);
  assert.equal(buildModel(rel("", { name: "  " })).title, null);
  assert.equal(buildModel(rel("", { name: "V1.0.0" })).title, null);
  assert.equal(buildModel(rel("", { name: " Big one " })).title, "Big one");
});

test("date: publishedAt wins, createdAt is the fallback, bad dates give an empty label", () => {
  assert.equal(buildModel(rel("", { publishedAt: null, createdAt: "2026-03-04T23:59:59Z" })).dateLabel, "4 Mar 2026");
  assert.equal(buildModel(rel("", { publishedAt: "2026-09-09T00:00:00Z" })).dateLabel, "9 Sep 2026"); // not "Sept"
  assert.equal(buildModel(rel("", { publishedAt: "2026-12-31T23:59:59Z" })).dateLabel, "31 Dec 2026");
  assert.equal(buildModel(rel("", { publishedAt: "garbage" })).dateLabel, "");
  assert.equal(buildModel(rel("", { publishedAt: null, createdAt: null })).date, "");
});

test("prerelease and latest flags are carried over", () => {
  const m = buildModel(rel("", { prerelease: true, latest: true }));
  assert.deepEqual([m.prerelease, m.latest], [true, true]);
});

test("Unicode: Swedish letters, emoji and RTL text survive parsing and cleaning", () => {
  const m = buildModel(rel("## Ändringar 🚀\n* Åtgärdat fel i bokföring 🎉 av @asa\n* مرحبا بالعالم"));
  assert.equal(m.sections[0].title, "Ändringar 🚀");
  assert.equal(cleanText(m.sections[0].items[0].text, { clean: true }), "Åtgärdat fel i bokföring 🎉 av asa");
  assert.equal(cleanText(m.sections[0].items[1].text, { clean: true }), "مرحبا بالعالم");
});

test("cleanText: the §12 table", () => {
  const c = (t) => cleanText(t, { clean: true });
  assert.equal(c("Fix X by @alice in https://github.com/o/r/pull/12"), "Fix X");
  assert.equal(c("Fix X (#12)"), "Fix X");
  assert.equal(c("Thanks @bob for the idea"), "Thanks bob for the idea");
  assert.equal(c("Fix X https://github.com/o/r/issues/7"), "Fix X");
  assert.equal(c("Fixes #12"), "Fixes");
  assert.equal(c("Fix X (#1) #2"), "Fix X");
  assert.equal(c("a   b  c"), "a b c");
  assert.equal(c("mail me at a@b.com"), "mail me at a@b.com"); // not a mention
  assert.equal(c("(@alice) and @bob."), "(alice) and bob.");
  assert.equal(c("See https://example.com/docs"), "See https://example.com/docs"); // only PR/issue URLs go
  assert.equal(c("(#12)"), ""); // can end up empty
  assert.equal(cleanText("Fix X (#12) by @a in https://x/pull/12", { clean: false }), "Fix X (#12) by @a in https://x/pull/12");
});
