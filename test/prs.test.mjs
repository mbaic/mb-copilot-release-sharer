import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel, mergePrs, prUrl, prsFromCommits } from "../plugins/release-sharer/com.github.copilot/extensions/release-sharer/lib/model.mjs";
import { format } from "../plugins/release-sharer/com.github.copilot/extensions/release-sharer/lib/formatters.mjs";
import { createReleaseLoader } from "../plugins/release-sharer/com.github.copilot/extensions/release-sharer/src/github.mjs";
import { createRuntime } from "../plugins/release-sharer/com.github.copilot/extensions/release-sharer/src/canvas.mjs";
import { fixture, rel, toRelease } from "./helpers.mjs";

const v241 = toRelease(fixture("v2.4.1.release.json"));
const commit = (message) => ({ commit: { message } });

test("model.prs: PRs named in the notes, linked to the release's repo, de-duplicated", () => {
  const m = buildModel(v241);
  assert.deepEqual(m.prs.map((p) => p.number), [482, 479, 488, 491]);
  assert.equal(m.prs[0].url, "https://github.com/acme/bc-app/pull/482");
  assert.equal(m.prs[0].title, "Posting preview now respects dimension filters");
  const squash = buildModel(rel("* Fix thing (#12)\n* Other (#12)"));
  assert.deepEqual(squash.prs.map((p) => p.number), [12]);
});

test("model.prs: empty without a GitHub release URL or without references", () => {
  assert.deepEqual(buildModel(rel("* Fix (#5)", { url: "javascript:alert(1)" })).prs, []);
  assert.deepEqual(buildModel(rel("Just prose.")).prs, []);
});

test("prUrl only builds github.com URLs from owner/repo and a positive integer", () => {
  assert.equal(prUrl("a/b", 3), "https://github.com/a/b/pull/3");
  for (const [repo, n] of [["a", 3], ["a/b", 0], ["a/b", "3"], ["a/b/c", 1], ["", 1], ["a/b c", 1]]) assert.equal(prUrl(repo, n), "", `${repo} ${n}`);
});

test("prsFromCommits: merge commits, squash commits, duplicates and junk", () => {
  const prs = prsFromCommits([
    commit("Merge pull request #7 from acme/feature\n\nAdd the thing"),
    commit("Fix rounding (#9)\n\nlong body (#10)"),
    commit("Merge pull request #7 from acme/feature\n\nAgain"),
    commit("Plain commit without reference"),
    commit("Mentions (#11) in the middle of a line"),
    null,
  ]);
  assert.deepEqual(prs, [{ number: 7, title: "Add the thing" }, { number: 9, title: "Fix rounding" }]);
  assert.deepEqual(prsFromCommits(undefined), []);
});

test("mergePrs unions by number, keeps the first entry and fills missing titles", () => {
  const a = [{ number: 2, url: "u2", title: "" }];
  const b = [{ number: 1, url: "u1", title: "one" }, { number: 2, url: "x", title: "two" }];
  assert.deepEqual(mergePrs(a, b), [{ number: 1, url: "u1", title: "one" }, { number: 2, url: "u2", title: "two" }]);
});

test("formatters: PR links in every format; off or empty changes nothing; unsafe URLs dropped", () => {
  const m = buildModel(rel("* A (#1)\n* B (#2)"));
  const prs = [{ number: 1, url: "https://github.com/o/r/pull/1" }, { number: 2, url: "javascript:alert(1)" }, { number: 3, url: "https://github.com/o/r/pull/3" }];
  const base = format(m, { format: "plain" }).body;
  assert.equal(format(m, { format: "plain", prs: [] }).body, base);
  assert.match(format(m, { format: "plain", prs }).body, /Pull requests:\n- #1 https:\/\/github.com\/o\/r\/pull\/1\n- #3 https:\/\/github.com\/o\/r\/pull\/3/);
  assert.doesNotMatch(format(m, { format: "plain", prs }).body, /javascript/);
  assert.match(format(m, { format: "markdown", prs }).body, /- \[#1\]\(https:\/\/github.com\/o\/r\/pull\/1\)/);
  assert.match(format(m, { format: "email", prs }).body, /Pull requests:\n- #1 /);
  const html = format(m, { format: "html", prs }).html;
  assert.match(html, /<a href="https:\/\/github.com\/o\/r\/pull\/3"[^>]*>#3<\/a>/);
  assert.doesNotMatch(html, /javascript/);
});

const raw = (id, tag, day) => ({
  id, tag_name: tag, name: tag, body: "", draft: false, prerelease: false,
  published_at: `2026-01-0${day}T00:00:00Z`, created_at: `2026-01-0${day}T00:00:00Z`, html_url: `https://github.com/o/r/releases/tag/${tag}`, author: null,
});

test("loader.previous and loader.compare", async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push(args.at(-1));
    const url = args.at(-1);
    if (url.includes("/compare/")) return { stdout: JSON.stringify({ total_commits: 150, commits: [{ commit: { message: "Fix (#4)" }, sha: "abc" }] }), stderr: "" };
    if (url.includes("/latest")) return { stdout: JSON.stringify({ id: 3 }), stderr: "" };
    return { stdout: JSON.stringify([raw(3, "v3", 3), raw(2, "v2", 2), raw(1, "v1", 1)]), stderr: "" };
  };
  const loader = createReleaseLoader({ exec });
  await loader.load({ owner: "o", repo: "r" });
  assert.equal(loader.previous("o", "r", "v3").tag, "v2");
  assert.equal(loader.previous("o", "r", "v1"), null);
  assert.equal(loader.previous("o", "r", "nope"), null);
  const res = await loader.compare({ owner: "o", repo: "r", base: "v2", head: "v3" });
  assert.deepEqual(res, { commits: [{ commit: { message: "Fix (#4)" } }], truncated: true });
  assert.equal(calls.at(-1), "repos/o/r/compare/v2...v3?per_page=100");
  await loader.compare({ owner: "o", repo: "r", base: "a/b", head: "c d" });
  assert.equal(calls.at(-1), "repos/o/r/compare/a%2Fb...c%20d?per_page=100");
  assert.ok((await loader.compare({ owner: "o", repo: "r", base: "", head: "x" })).error);
});

test("loader.compare maps gh failures to error codes", async () => {
  const exec = async () => { throw Object.assign(new Error("x"), { stderr: "HTTP 404: Not Found" }); };
  const res = await createReleaseLoader({ exec }).compare({ owner: "o", repo: "r", base: "a", head: "b" });
  assert.equal(res.error.code, "repo_not_found");
});

function runtime(loader) {
  const rt = createRuntime(() => ({ send: async () => {} }), {
    github: { isValidRepo: (s) => /^[\w.-]+\/[\w.-]+$/.test(s), detectRepo: async () => ({ owner: "acme", repo: "bc-app", full: "acme/bc-app" }), defaultExec() {} },
    loader,
    state: { getRepoOverride: () => null, setRepoOverride() {}, patch() {}, flush: async () => {}, get: () => ({ ui: {}, repos: {} }) },
    log: { error() {}, warn() {}, info() {} }, extDir: "/x", version: "0.0.0",
  });
  return rt.canvas.actions.find((a) => a.name === "get_release_prs").handler;
}
const ctx = (input) => ({ instanceId: "i", sessionId: "s", session: { workingDirectory: "/w" }, input });

test("get_release_prs merges notes with commits since the previous release", async () => {
  const loader = {
    get: (o, r, t) => (t === "v2.4.1" ? v241 : null),
    previous: () => ({ tag: "v2.4.0" }),
    load: async () => ({ releases: [], hasMore: false }),
    compare: async () => ({ commits: [commit("Merge pull request #500 from a/b\n\nHot fix"), commit("Dup (#482)")], truncated: false }),
  };
  const res = await runtime(loader)(ctx({ tag: "v2.4.1" }));
  assert.deepEqual(res.prs.map((p) => p.number), [479, 482, 488, 491, 500]);
  assert.equal(res.prs.at(-1).url, "https://github.com/acme/bc-app/pull/500");
  assert.equal(res.base, "v2.4.0");
  assert.equal(res.partial, false);
});

test("get_release_prs falls back to the notes when there is no previous release or compare fails", async () => {
  const base = { get: () => v241, load: async () => ({ releases: [], hasMore: false }) };
  const none = await runtime({ ...base, previous: () => null, compare: async () => { throw new Error("unused"); } })(ctx({ tag: "v2.4.1" }));
  assert.equal(none.prs.length, 4);
  assert.equal(none.partial, true);
  const failed = await runtime({ ...base, previous: () => ({ tag: "p" }), compare: async () => ({ error: { code: "network" } }) })(ctx({ tag: "v2.4.1" }));
  assert.equal(failed.prs.length, 4);
  assert.equal(failed.partial, true);
});
