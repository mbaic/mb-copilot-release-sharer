import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, safeUrl, inlineToHtml, inlineToPlain, neutralizeUnsafeLinks } from "../plugins/release-sharer/com.github.copilot/extensions/release-sharer/lib/markdown.mjs";
import { fixture } from "./helpers.mjs";

test("escapeHtml escapes & < > \" '", () => {
  assert.equal(escapeHtml("<a href=\"x\" onclick='y'>&</a>"), "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  assert.equal(escapeHtml(42), "42");
});

test("safeUrl: only http(s) survives", () => {
  assert.equal(safeUrl("https://example.com/a?b=1#c"), "https://example.com/a?b=1#c");
  assert.equal(safeUrl("  HTTP://Example.com  "), "HTTP://Example.com");
  const bad = [
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "java\nscript:alert(1)", " \u0001javascript:alert(1)",
    "data:text/html;base64,AAAA", "vbscript:x", "file:///etc/passwd", "//evil.example", "/relative/path", "#anchor",
    "mailto:a@b.c", "https:", "https://", "https:///x", "", null, undefined, 5,
  ];
  for (const u of bad) assert.equal(safeUrl(u), null, String(u));
  assert.equal(safeUrl("https://exa​mple.com"), "https://example.com"); // zero-width characters are stripped
});

test("neutralizeUnsafeLinks keeps http(s) links and drops the rest to their text", () => {
  assert.equal(neutralizeUnsafeLinks("[a](https://x.y) [b](javascript:alert(1)) [c](/rel)"), "[a](https://x.y) b c");
  assert.equal(neutralizeUnsafeLinks("[t](java\tscript:alert(2)) [u](JaVaScRiPt:x) [v](data:text/html,x)"), "t u v");
  assert.equal(neutralizeUnsafeLinks('[a](https://x.y "title") [w](https://en.wikipedia.org/wiki/A_(b))'), '[a](https://x.y "title") [w](https://en.wikipedia.org/wiki/A_(b))');
  assert.equal(neutralizeUnsafeLinks("<javascript:alert(1)> <https://ok.example>"), "javascript:alert(1) <https://ok.example>");
  assert.equal(neutralizeUnsafeLinks("[r]: javascript:alert(1)\n[s]: https://ok.example"), "\n[s]: https://ok.example");
});

test("inlineToHtml: escape first, then markup", () => {
  assert.equal(inlineToHtml("a <b> & c"), "a &lt;b&gt; &amp; c");
  assert.equal(inlineToHtml("**bold** and *em* and _em2_"), "<strong>bold</strong> and <em>em</em> and <em>em2</em>");
  assert.match(inlineToHtml("`x < y`"), /^<code style="[^"]*">x &lt; y<\/code>$/);
  assert.equal(inlineToHtml("snake_case_name and 2 * 3 * 4"), "snake_case_name and 2 * 3 * 4");
});

test("inlineToHtml: links go through safeUrl; markup inside code and URLs is left alone", () => {
  assert.equal(inlineToHtml("[docs](https://e.com/a_b_c)"), '<a href="https://e.com/a_b_c" style="color:#0969da" target="_blank" rel="noopener noreferrer">docs</a>');
  assert.equal(inlineToHtml("[x](javascript:alert(1))"), "x");
  assert.equal(inlineToHtml("[**x**](https://e.com)").includes("<strong>x</strong></a>"), true);
  assert.equal(inlineToHtml("`**not bold**`").includes("<strong>"), false);
  assert.equal(inlineToHtml("[a&b](https://e.com/?x=1&y=2)").includes('href="https://e.com/?x=1&amp;y=2"'), true);
});

test("inlineToPlain: links, keepUrls and markup stripping", () => {
  assert.equal(inlineToPlain("See [docs](https://e.com)"), "See docs");
  assert.equal(inlineToPlain("See [docs](https://e.com)", { keepUrls: true }), "See docs (https://e.com)");
  assert.equal(inlineToPlain("[https://e.com](https://e.com)", { keepUrls: true }), "https://e.com");
  assert.equal(inlineToPlain("[x](javascript:alert(1))", { keepUrls: true }), "x");
  assert.equal(inlineToPlain("**b** *e* _e_ `c` snake_case"), "b e e c snake_case");
  assert.equal(inlineToPlain("`*a*`"), "*a*");
  assert.equal(inlineToPlain("[**b**](https://e.com/a_b_)"), "b");
});

test("NUL characters in input cannot forge placeholders", () => {
  assert.equal(inlineToHtml("a\u00000\u0000b `c`").includes("undefined"), false);
  assert.equal(inlineToPlain("a\u00000\u0000b").includes("\u0000"), false);
});

test("XSS corpus: no active markup, no javascript: href, in any inline output", () => {
  const corpus = [
    "<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "\"><svg onload=alert(1)>", "'><iframe src=javascript:alert(1)>",
    "[x](javascript:alert(1))", "[x](JAVASCRIPT:alert(1))", "[x](java&#x09;script:alert(1))", "[x](data:text/html,<script>alert(1)</script>)",
    "[<script>](https://e.com)", "[x](https://e.com\" onmouseover=\"alert(1))", "**<b onmouseover=alert(1)>**", "`</code><script>`",
    "[a](https://e.com/\"><script>alert(1)</script>)", "<a href=\"javascript:alert(1)\">x</a>", "<script>",
  ];
  for (const input of corpus) {
    const out = inlineToHtml(input);
    // Only our own tags may appear, and links carry only our own attributes.
    assert.doesNotMatch(out, /<(?!\/?(?:a|code|strong|em)[\s>])/, input);
    for (const a of out.match(/<a [^>]*>/g) ?? []) {
      assert.match(a, /^<a href="https?:\/\/[^"<>]*" style="color:#0969da" target="_blank" rel="noopener noreferrer">$/, input);
    }
    assert.doesNotMatch(out, /href="javascript:/i, input);
  }
});

import { textToHtml } from "../plugins/release-sharer/com.github.copilot/extensions/release-sharer/lib/markdown.mjs";

test("textToHtml (plain): linkifies bare URLs, keeps trailing punctuation outside, escapes everything", () => {
  const html = textToHtml("Hi <b>all</b>,\nSee https://github.com/o/r/releases/tag/v1.\n\n- #1 https://github.com/o/r/pull/1\njavascript:alert(1) data:text/html,x");
  assert.match(html, /Hi &lt;b&gt;all&lt;\/b&gt;,<br>See <a href="https:\/\/github.com\/o\/r\/releases\/tag\/v1"[^>]*>https:\/\/github.com\/o\/r\/releases\/tag\/v1<\/a>\./);
  assert.match(html, /<ul[^>]*><li>#1 <a href="https:\/\/github.com\/o\/r\/pull\/1"/);
  assert.doesNotMatch(html, /href="javascript|<b>/);
});

test("textToHtml (markdown): headings, bullets, links; unsafe links lose their target", () => {
  const html = textToHtml("## v1\n\n### Fixes\n- [#1](https://github.com/o/r/pull/1) fix\n- [x](javascript:alert(1))", { markdown: true });
  assert.match(html, /font-weight:600">v1<\/p>/);
  assert.match(html, /<li><a href="https:\/\/github.com\/o\/r\/pull\/1"[^>]*>#1<\/a> fix<\/li>/);
  assert.doesNotMatch(html, /javascript/);
});
