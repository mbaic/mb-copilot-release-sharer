import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRemote, isValidRepo, classifyGhError, detectRepo, createReleaseLoader } from "../plugins/release-sharer/com.github.copilot/extensions/release-sharer/src/github.mjs";

const stderrFx = (name) => readFileSync(fileURLToPath(new URL(`./fixtures/gh-errors/${name}.stderr.txt`, import.meta.url)), "utf8");
const fail = (code, stderr = "") => Object.assign(new Error("failed"), { code, stderr });

test("parseRemote matrix", () => {
  const want = { host: "github.com", owner: "acme", repo: "bc-app" };
  for (const url of [
    "https://github.com/acme/bc-app",
    "https://github.com/acme/bc-app.git",
    "https://github.com/acme/bc-app/",
    "https://github.com/acme/bc-app.git/",
    "http://github.com/acme/bc-app",
    "git@github.com:acme/bc-app.git",
    "git@github.com:acme/bc-app",
    "ssh://git@github.com/acme/bc-app.git",
    "ssh://git@github.com:22/acme/bc-app.git",
    "https://GitHub.com/acme/bc-app.GIT",
    "  https://github.com/acme/bc-app\n",
    "git://github.com/acme/bc-app.git",
  ]) assert.deepEqual(parseRemote(url), want, url);
});

test("parseRemote strips credentials and keeps owner/repo case", () => {
  assert.deepEqual(parseRemote("https://user:ghp_secret@github.com/Acme/BC-App.git"), { host: "github.com", owner: "Acme", repo: "BC-App" });
  assert.deepEqual(parseRemote("ssh://user:pw@github.com:2222/a/b"), { host: "github.com", owner: "a", repo: "b" });
  assert.doesNotMatch(JSON.stringify(parseRemote("https://x:tok@github.com/a/b")), /tok/);
});

test("parseRemote: other hosts parse, junk does not", () => {
  assert.equal(parseRemote("git@ghe.example.com:o/r.git").host, "ghe.example.com");
  for (const bad of ["", null, undefined, 5, "not a url", "https://github.com/onlyowner", "https://github.com/a/b/c", "C:\\repos\\x", "/local/path/repo", "https://github.com/", "git@github.com:a"]) {
    assert.equal(parseRemote(bad), null, String(bad));
  }
});

test("isValidRepo", () => {
  for (const ok of ["a/b", "acme/bc-app", "A_b.c/d-e.f"]) assert.equal(isValidRepo(ok), true, ok);
  for (const bad of ["", "a", "a/b/c", "/b", "a/", "a b/c", "a/b;rm", "-x/y z", "a/b\n", "a/$(x)", "../x", null, 5]) {
    if (bad === "../x") continue; // dots are allowed by the plan's regex; gh/GitHub reject them as 404
    assert.equal(isValidRepo(bad), false, String(bad));
  }
});

test("classifyGhError: fixtures and error shapes", () => {
  assert.equal(classifyGhError(stderrFx("not-logged-in")).code, "gh_not_authenticated");
  assert.equal(classifyGhError(stderrFx("not-found")).code, "repo_not_found");
  assert.equal(classifyGhError(stderrFx("sso-403")).code, "forbidden");
  const rl = classifyGhError(stderrFx("rate-limit"));
  assert.equal(rl.code, "rate_limited");
  assert.equal(rl.resetAt, new Date(1790000000 * 1000).toISOString());
  assert.equal(classifyGhError(fail("ENOENT")).code, "gh_missing");
  assert.equal(classifyGhError(Object.assign(new Error("x"), { killed: true, signal: "SIGTERM" })).code, "timeout");
  assert.equal(classifyGhError(fail(1, "dial tcp: lookup api.github.com: no such host")).code, "network");
  assert.equal(classifyGhError(fail(1, "something odd")).code, "unknown");
  assert.equal(classifyGhError(fail(1, "gh: Not Found (HTTP 404)")).code, "repo_not_found");
  assert.equal(classifyGhError(undefined).code, "unknown");
  const e = classifyGhError("HTTP 401");
  assert.ok(e.message && e.hint);
  assert.equal(classifyGhError(fail(1, "API rate limit exceeded (HTTP 403)")).resetAt, undefined);
});

test("detectRepo: origin, fallback remote, errors", async () => {
  const calls = [];
  const ok = (url) => async (file, args, opts) => { calls.push({ file, args, opts }); return { stdout: url + "\n", stderr: "" }; };
  const r = await detectRepo("/w", { exec: ok("git@github.com:acme/bc-app.git") });
  assert.deepEqual(r, { host: "github.com", owner: "acme", repo: "bc-app", full: "acme/bc-app" });
  assert.deepEqual(calls[0].args, ["-C", "/w", "remote", "get-url", "origin"]);
  assert.equal(calls[0].file, "git");
  assert.equal(calls[0].opts.timeout, 5000);

  const seq = [];
  const noOrigin = async (_f, args) => {
    seq.push(args.slice(2).join(" "));
    if (args[3] === "get-url" && args[4] === "origin") throw fail(2, "No such remote");
    if (args[2] === "remote" && args.length === 3) return { stdout: "upstream\nother\n", stderr: "" };
    return { stdout: "https://github.com/o/r.git", stderr: "" };
  };
  assert.equal((await detectRepo("/w", { exec: noOrigin })).full, "o/r");
  assert.deepEqual(seq, ["remote get-url origin", "remote", "remote get-url upstream"]);

  const none = async () => { throw fail(128, "fatal: not a git repository"); };
  assert.equal((await detectRepo("/w", { exec: none })).error.code, "not_a_repo");
  assert.equal((await detectRepo("/w", { exec: async () => { throw fail("ENOENT"); } })).error.code, "not_a_repo");
  assert.equal((await detectRepo("/w", { exec: async () => ({ stdout: "", stderr: "" }) })).error.code, "not_a_repo");
  const ghe = await detectRepo("/w", { exec: ok("https://ghe.corp.com/o/r.git") });
  assert.equal(ghe.error.code, "unsupported_host");
  assert.ok(ghe.error.hint);
  assert.equal((await detectRepo("", { exec: ok("x") })).error.code, "not_a_repo");
});

// ---- release loader ----

const raw = (id, tag, extra = {}) => ({
  id, tag_name: tag, name: `Name ${tag}`, body: `body ${tag}`, draft: false, prerelease: false,
  published_at: `2026-0${id}-01T00:00:00Z`, created_at: `2026-0${id}-01T00:00:00Z`,
  html_url: `https://github.com/o/r/releases/tag/${tag}`, author: { login: "alice" }, ...extra,
});

/** Fake gh: routes by URL; counts calls. */
function fakeGh({ list, latest, listError, latestError } = {}) {
  const calls = [];
  const exec = async (file, args, opts) => {
    calls.push({ file, args, opts });
    const url = args[args.length - 1];
    if (url.includes("/releases/latest")) {
      if (latestError) throw latestError;
      return { stdout: JSON.stringify(latest), stderr: "" };
    }
    if (listError) throw listError;
    return { stdout: typeof list === "function" ? list(url) : JSON.stringify(list), stderr: "" };
  };
  return { exec, calls, listCalls: () => calls.filter((c) => !c.args.at(-1).includes("/latest")) };
}

test("load: command shape, mapping, draft filtering, sorting, latest", async () => {
  const items = [
    raw(1, "v1.0.0"),
    raw(3, "v3.0.0", { prerelease: true }),
    raw(4, "v4.0.0-draft", { draft: true }),
    raw(2, "v2.0.0", { name: null, body: null, published_at: null, author: null }),
  ];
  const gh = fakeGh({ list: items, latest: { id: 2 } });
  const loader = createReleaseLoader({ exec: gh.exec });
  const res = await loader.load({ owner: "o", repo: "r" });
  assert.deepEqual(res.releases.map((r) => r.tag), ["v3.0.0", "v2.0.0", "v1.0.0"]); // v2 falls back to created_at
  assert.equal(res.page, 1);
  assert.equal(res.hasMore, false);
  assert.deepEqual(res.releases.filter((r) => r.latest).map((r) => r.tag), ["v2.0.0"]);
  assert.deepEqual(res.releases[0], {
    id: 3, tag: "v3.0.0", name: "Name v3.0.0", body: "body v3.0.0", draft: false, prerelease: true,
    publishedAt: "2026-03-01T00:00:00Z", createdAt: "2026-03-01T00:00:00Z",
    url: "https://github.com/o/r/releases/tag/v3.0.0", author: "alice", latest: false,
  });
  assert.equal(res.releases[1].name, null);
  assert.equal(res.releases[1].body, "");
  assert.equal(res.releases[1].author, null);
  const list = gh.listCalls()[0];
  assert.equal(list.file, "gh");
  assert.deepEqual(list.args, ["api", "-H", "Accept: application/vnd.github+json", "repos/o/r/releases?per_page=30&page=1"]);
  assert.equal(list.opts.timeout, 20000);
  assert.equal(list.opts.maxBuffer, 20 * 1024 * 1024);
});

test("load: latest falls back to the first non-prerelease when the lookup fails", async () => {
  const gh = fakeGh({ list: [raw(3, "v3", { prerelease: true }), raw(2, "v2"), raw(1, "v1")], latestError: fail(1, "HTTP 404") });
  const res = await createReleaseLoader({ exec: gh.exec }).load({ owner: "o", repo: "r" });
  assert.deepEqual(res.releases.filter((r) => r.latest).map((r) => r.tag), ["v2"]);
});

test("load: latest is only requested and marked on page 1", async () => {
  const gh = fakeGh({ list: [raw(2, "v2"), raw(1, "v1")], latest: { id: 1 } });
  const loader = createReleaseLoader({ exec: gh.exec });
  const p2 = await loader.load({ owner: "o", repo: "r", page: 2, perPage: 2 });
  assert.equal(p2.page, 2);
  assert.equal(p2.hasMore, true);
  assert.equal(p2.releases.some((r) => r.latest), false);
  assert.equal(gh.calls.some((c) => c.args.at(-1).includes("/latest")), false);
  assert.match(gh.listCalls()[0].args.at(-1), /per_page=2&page=2$/);
});

test("load: hasMore compares the raw item count (drafts included) with perPage", async () => {
  const gh = fakeGh({ list: [raw(2, "v2"), raw(1, "v1", { draft: true })], latest: { id: 2 } });
  const res = await createReleaseLoader({ exec: gh.exec }).load({ owner: "o", repo: "r", perPage: 2 });
  assert.equal(res.hasMore, true);
  assert.equal(res.releases.length, 1);
});

test("load: duplicate ids within a response are dropped", async () => {
  const gh = fakeGh({ list: [raw(1, "v1"), raw(1, "v1")], latest: { id: 1 } });
  const res = await createReleaseLoader({ exec: gh.exec }).load({ owner: "o", repo: "r" });
  assert.equal(res.releases.length, 1);
});

test("load: cache TTL, force and clear", async () => {
  let t = 1000;
  const gh = fakeGh({ list: [raw(1, "v1")], latest: { id: 1 } });
  const loader = createReleaseLoader({ exec: gh.exec, now: () => t, ttlMs: 60000 });
  const a = await loader.load({ owner: "o", repo: "r" });
  t += 59999;
  assert.equal(await loader.load({ owner: "o", repo: "r" }), a);
  assert.equal(gh.listCalls().length, 1);
  t += 2;
  await loader.load({ owner: "o", repo: "r" });
  assert.equal(gh.listCalls().length, 2);
  await loader.load({ owner: "o", repo: "r", force: true });
  assert.equal(gh.listCalls().length, 3);
  await loader.load({ owner: "o", repo: "r", page: 2 }); // different key
  assert.equal(gh.listCalls().length, 4);
  await loader.load({ owner: "O", repo: "R" }); // repo names are case-insensitive for the cache
  assert.equal(gh.listCalls().length, 4);
  loader.clear();
  await loader.load({ owner: "o", repo: "r" });
  assert.equal(gh.listCalls().length, 5);
});

test("load: concurrent identical requests share one call", async () => {
  const gh = fakeGh({ list: [raw(1, "v1")], latest: { id: 1 } });
  const loader = createReleaseLoader({ exec: gh.exec });
  const [a, b] = await Promise.all([loader.load({ owner: "o", repo: "r" }), loader.load({ owner: "o", repo: "r", force: true })]);
  assert.equal(a, b);
  assert.equal(gh.listCalls().length, 1);
});

test("load: errors are returned, not thrown, and are not cached", async () => {
  let fails = true;
  const exec = async (_f, args) => {
    if (args.at(-1).includes("/latest")) throw fail(1, "HTTP 404");
    if (fails) throw fail(1, stderrFx("not-logged-in"));
    return { stdout: "[]", stderr: "" };
  };
  const loader = createReleaseLoader({ exec });
  const bad = await loader.load({ owner: "o", repo: "r" });
  assert.equal(bad.error.code, "gh_not_authenticated");
  assert.ok(bad.error.hint);
  fails = false;
  assert.deepEqual(await loader.load({ owner: "o", repo: "r" }), { releases: [], hasMore: false, page: 1 });
});

test("load: invalid input and bad JSON", async () => {
  const gh = fakeGh({ list: "{not json", latest: {} });
  const loader = createReleaseLoader({ exec: gh.exec });
  for (const [owner, repo] of [["a b", "r"], ["o", "r;x"], ["", "r"], [undefined, undefined], ["o/x", "r"]]) {
    assert.equal((await loader.load({ owner, repo })).error.code, "invalid_repo", `${owner}/${repo}`);
  }
  assert.equal(gh.calls.length, 0);
  assert.equal((await loader.load({ owner: "o", repo: "r" })).error.code, "unknown");
  const notArray = createReleaseLoader({ exec: fakeGh({ list: { message: "x" }, latest: {} }).exec });
  assert.equal((await notArray.load({ owner: "o", repo: "r" })).error.code, "unknown");
  assert.equal((await loader.load({ owner: "o", repo: "r", perPage: 500 })).error.code, "unknown");
});

test("load: timeout and missing gh map to codes", async () => {
  const slow = createReleaseLoader({ exec: async () => { throw Object.assign(new Error("timed out"), { killed: true, signal: "SIGTERM" }); } });
  assert.equal((await slow.load({ owner: "o", repo: "r" })).error.code, "timeout");
  const none = createReleaseLoader({ exec: async () => { throw fail("ENOENT"); } });
  assert.equal((await none.load({ owner: "o", repo: "r" })).error.code, "gh_missing");
});

test("gh lookup order, and the found path is cached", async () => {
  const tried = [];
  const exec = async (file, args) => {
    tried.push(file);
    if (file !== "/usr/local/bin/gh") throw fail("ENOENT");
    return { stdout: args.at(-1).includes("/latest") ? "{}" : "[]", stderr: "" };
  };
  const loader = createReleaseLoader({ exec });
  await loader.load({ owner: "o", repo: "r" });
  assert.deepEqual(tried.slice(0, 3), ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh"]);
  tried.length = 0;
  await loader.load({ owner: "o", repo: "r", force: true });
  assert.deepEqual([...new Set(tried)], ["/usr/local/bin/gh"]);
});

test("gh lookup: a non-ENOENT failure stops the search", async () => {
  const tried = [];
  const exec = async (file) => { tried.push(file); throw fail(1, "HTTP 404"); };
  const res = await createReleaseLoader({ exec }).load({ owner: "o", repo: "r" });
  assert.equal(res.error.code, "repo_not_found");
  assert.equal(new Set(tried).size, 1);
});

test("get returns releases seen by earlier loads", async () => {
  const gh = fakeGh({ list: [raw(2, "v2"), raw(1, "v1")], latest: { id: 2 } });
  const loader = createReleaseLoader({ exec: gh.exec });
  assert.equal(loader.get("o", "r", "v2"), null);
  await loader.load({ owner: "o", repo: "r" });
  assert.equal(loader.get("o", "r", "v2").id, 2);
  assert.equal(loader.get("O", "R", "v1").id, 1);
  assert.equal(loader.get("o", "r", "nope"), null);
  loader.clear();
  assert.equal(loader.get("o", "r", "v2"), null);
});
