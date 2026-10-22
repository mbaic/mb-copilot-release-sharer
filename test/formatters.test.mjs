import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../plugins/release-sharer/com.github.copilot/extensions/release-sharer/lib/model.mjs";
import { format } from "../plugins/release-sharer/com.github.copilot/extensions/release-sharer/lib/formatters.mjs";
import { fixture, toRelease, rel } from "./helpers.mjs";

// The 8 golden files are in golden.test.mjs; this file has the targeted assertions.
const model = buildModel(toRelease(fixture("v2.4.1.release.json")));
const FORMATS = ["plain", "markdown", "email", "html"];
const run = (m, o) => format(m, { repoLabel: "acme/bc-app", ...o });
const text = (out) => (out.html ?? out.body);

test("contributors off removes the line in every format", () => {
  for (const f of FORMATS) {
    const out = run(model, { format: f, contributors: false });
    assert.doesNotMatch(text(out), /Contributors:/, f);
    assert.match(text(out), /Full release notes/, f);
  }
});

test("link off removes the link line in every format", () => {
  for (const f of FORMATS) {
    const out = run(model, { format: f, link: false });
    assert.doesNotMatch(text(out), /Full release notes/, f);
    assert.match(text(out), /Contributors: alice, bjorn, carla/, f);
  }
});

test("both tail lines off: nothing trails the last section", () => {
  assert.equal(run(model, { format: "plain", contributors: false, link: false }).body.endsWith("Missing permission set for Sales Quote archive"), true);
});

test("a release without a url never produces a link line", () => {
  const m = buildModel(rel("## A\n* x", { url: "" }));
  assert.doesNotMatch(run(m, { format: "plain" }).body, /Full release notes/);
  assert.doesNotMatch(run(m, { format: "markdown" }).body, /Full release notes/);
  assert.doesNotMatch(run(m, { format: "html" }).html, /Full release notes/);
  const bad = buildModel(rel("## A\n* x", { url: "javascript:alert(1)" }));
  assert.doesNotMatch(run(bad, { format: "html" }).html, /javascript:|Full release notes/);
});

test("null title: markdown heading is the tag alone, email subject has no suffix, plain has no title line", () => {
  const m = buildModel(rel("## Fixes\n* a", { name: "v1.0.0" }));
  assert.equal(run(m, { format: "markdown" }).body.split("\n")[0], "## v1.0.0");
  assert.equal(run(m, { format: "email" }).subject, "[acme/bc-app] v1.0.0 released");
  assert.equal(run(m, { format: "plain" }).body.split("\n").slice(0, 3).join("|"), "v1.0.0 (2 Jan 2026)||Fixes");
});

test("email: subject format, repoLabel optional, missing date", () => {
  assert.equal(run(model, { format: "email" }).subject, "[acme/bc-app] v2.4.1 released: Posting preview and dimension fixes");
  assert.equal(format(model, { format: "email" }).subject, "v2.4.1 released: Posting preview and dimension fixes");
  const noDate = buildModel(rel("## A\n* x", { publishedAt: null }));
  assert.match(run(noDate, { format: "email" }).body, /^Hi all,\n\nv1\.0\.0 is now available\.\n/);
  assert.doesNotMatch(run(noDate, { format: "plain" }).body.split("\n")[0], /\(/);
});

test("rewrite replaces all sections with one plain-text paragraph; header and tail stay", () => {
  const rewrite = "Customers can now filter the posting preview by dimension.\r\nVAT rounding is fixed.  ";
  const expect = "Customers can now filter the posting preview by dimension.\nVAT rounding is fixed.";
  const plain = run(model, { format: "plain", rewrite }).body;
  assert.equal(plain, ["v2.4.1 (9 Oct 2026)", "Posting preview and dimension fixes", "", expect, "", "Contributors: alice, bjorn, carla", "", "Full release notes and app for download: https://github.com/acme/bc-app/releases/tag/v2.4.1", "", "Download a new app/PTE app from the link above, extract and install in sandboxes first, then prod environment:\n[screenshot-placeholder]"].join("\n"));
  assert.doesNotMatch(plain, /Features|Fixes/);
  const email = run(model, { format: "email", rewrite }).body;
  assert.match(email, /\(released 9 Oct 2026\)\.\n\nCustomers can now/);
  assert.match(email, /screenshot-placeholder\]$/);
  const md = run(model, { format: "markdown", rewrite }).body;
  assert.match(md, /_Released 9 Oct 2026_\n\nCustomers can now/);
  assert.doesNotMatch(md, /###/);
});

test("rewrite is plain text: markup is not interpreted and HTML is escaped", () => {
  const rewrite = "Use **this** <b>now</b> [x](javascript:alert(1)) <script>alert(1)</script>";
  const html = run(model, { format: "html", rewrite }).html;
  assert.doesNotMatch(html, /<script|<b>|<strong>|<a href="javascript/);
  assert.match(html, /\*\*this\*\* &lt;b&gt;now&lt;\/b&gt;/);
  assert.equal(run(model, { format: "plain", rewrite }).body.includes("**this**"), true);
  assert.equal(run(model, { format: "plain", rewrite: "   " }).body, run(model, { format: "plain" }).body); // blank rewrite is ignored
});

test("sections with only paragraphs render in every format", () => {
  const m = buildModel(rel("Release with only prose.\n\nSecond paragraph with [a link](https://e.com) and **bold**."));
  assert.equal(run(m, { format: "plain", link: false, contributors: false }).body, "v1.0.0 (2 Jan 2026)\n\nNotes\nRelease with only prose.\n\nSecond paragraph with a link and bold.");
  assert.equal(run(m, { format: "plain", clean: false, link: false }).body.endsWith("a link (https://e.com) and bold."), true);
  assert.match(run(m, { format: "markdown", link: false }).body, /### Notes\nRelease with only prose\.\n\nSecond paragraph with \[a link\]\(https:\/\/e\.com\) and \*\*bold\*\*\./);
  assert.match(run(m, { format: "html" }).html, /<p style="margin:8px 0 0">Second paragraph with <a href="https:\/\/e\.com"[^>]*>a link<\/a> and <strong>bold<\/strong>\.<\/p>/);
});

test("empty body: header and tail only", () => {
  const m = buildModel(rel(""));
  assert.equal(run(m, { format: "plain" }).body, "v1.0.0 (2 Jan 2026)\n\nFull release notes and app for download: https://github.com/o/r/releases/tag/v1.0.0\n\nDownload a new app/PTE app from the link above, extract and install in sandboxes first, then prod environment:\n[screenshot-placeholder]");
});

test("clean off keeps links per §12; clean on drops urls in plain/email, keeps markdown syntax", () => {
  const m = buildModel(rel("## A\n* See [docs](https://e.com) now"));
  const o = { link: false, contributors: false };
  assert.match(run(m, { format: "plain", clean: true, ...o }).body, /- See docs now/);
  assert.match(run(m, { format: "plain", clean: false, ...o }).body, /- See docs \(https:\/\/e\.com\) now/);
  assert.match(run(m, { format: "email", clean: true, ...o }).body, /- See docs now/);
  assert.match(run(m, { format: "email", clean: false, ...o }).body, /- See docs \(https:\/\/e\.com\) now/);
  for (const clean of [true, false]) assert.match(run(m, { format: "markdown", clean, ...o }).body, /- See \[docs\]\(https:\/\/e\.com\) now/);
  for (const clean of [true, false]) assert.match(run(m, { format: "html", clean, ...o }).html, /<li>See <a href="https:\/\/e\.com"/);
});

test("cleaning drops items that end up empty and sections that end up empty", () => {
  const m = buildModel(rel("## A\n* (#1)\n\n## B\n* kept (#2)"));
  const out = run(m, { format: "plain", link: false, contributors: false }).body;
  assert.equal(out, "v1.0.0 (2 Jan 2026)\n\nB\n- kept");
});

test("nested items and code blocks", () => {
  const m = buildModel(rel("## A\n* parent (#1)\n  * child by @zed in https://github.com/o/r/pull/3\n\n```sh\nnpm i @scope/pkg (#1)\n```"));
  const o = { link: false };
  assert.equal(run(m, { format: "plain", ...o }).body, "v1.0.0 (2 Jan 2026)\n\nA\nnpm i @scope/pkg (#1)\n\n- parent\n  - child\n\nContributors: zed");
  assert.equal(run(m, { format: "markdown", ...o }).body.includes("- parent\n  - child\n"), true);
  assert.equal(run(m, { format: "markdown", ...o }).body.includes("```sh\nnpm i @scope/pkg (#1)\n```"), true); // code never cleaned
  const html = run(m, { format: "html", ...o }).html;
  assert.match(html, /<li>parent<ul style="[^"]*"><li>child<\/li><\/ul><\/li>/);
  assert.match(html, /<pre [^>]*>npm i @scope\/pkg \(#1\)<\/pre>/);
});

test("unsafe links are neutralized in markdown, plain and email, and absent from html", () => {
  const m = buildModel(rel("## A\n* [x](javascript:alert(1)) and [y](https://ok.example)"));
  const o = { link: false, contributors: false };
  assert.match(run(m, { format: "markdown", ...o }).body, /- x and \[y\]\(https:\/\/ok\.example\)/);
  assert.match(run(m, { format: "plain", clean: false, ...o }).body, /- x and y \(https:\/\/ok\.example\)/);
  assert.doesNotMatch(run(m, { format: "html", ...o }).html, /javascript:/i);
});

test("unknown format throws", () => {
  assert.throws(() => format(model, { format: "pdf" }), /Unknown format/);
});

// --- cross-format invariants ---------------------------------------------------------------

const crlf = buildModel(rel("## What's Changed\r\n* One by @a in https://github.com/o/r/pull/1\r\n* Two\r\n"));
const unicode = buildModel(rel("## Ändringar 🚀\n* Åtgärdat fel 🎉\n* مرحبا بالعالم\n\nSlut. "));
const xss = buildModel(toRelease(fixture("xss.release.json")));
const big = buildModel(rel("## A\n" + "* item (#1) by @someone in https://github.com/o/r/pull/1\n".repeat(6000)));
const samples = { fixture: model, crlf, unicode, xss, big, empty: buildModel(rel("")), freeform: buildModel(rel("Just prose.   \n\n\n\nMore.")) };

for (const [name, m] of Object.entries(samples)) {
  for (const f of FORMATS) {
    for (const clean of [true, false]) {
      test(`invariants: ${name} / ${f} / clean ${clean}`, () => {
        const opts = { format: f, clean };
        const out = run(m, opts);
        const parts = [out.body, out.html, out.subject].filter((x) => x !== undefined);
        for (const p of parts) {
          assert.doesNotMatch(p, /\r/, "only \\n line endings");
          assert.doesNotMatch(p, /[ \t]+$/m, "no trailing spaces");
          assert.doesNotMatch(p, /\n$/, "no trailing newline");
          assert.doesNotMatch(p, /\u0000/, "no NUL");
        }
        assert.deepEqual(run(m, opts), out, "deterministic");
        if (f === "html") {
          assert.doesNotMatch(out.html, /<script|javascript:/i);
          assert.doesNotMatch(out.html, /<(?!\/?(?:div|ul|li|p|a|pre|code|strong|em|br)[\s>])/, "only allowed tags");
          assert.doesNotMatch(out.html, /<style|class=/i, "inline styles only");
          for (const a of out.html.match(/<a [^>]*>/g) ?? []) assert.match(a, /href="https?:\/\//);
        }
        if (f === "markdown" || f === "plain" || f === "email") assert.doesNotMatch(out.body, /\]\((?!https?:\/\/)/, "no non-http(s) markdown links");
      });
    }
  }
}

test("html text/plain companion has no HTML", () => {
  const out = run(xss, { format: "html" });
  assert.doesNotMatch(out.body, /<div|<ul|<li|<a /);
});
