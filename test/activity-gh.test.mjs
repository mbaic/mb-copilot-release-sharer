import { test } from "node:test";
import assert from "node:assert/strict";
import { createActivityLoader } from "../plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/src/gh.mjs";
import { classifyGhError, describeGraphqlErrors } from "../plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/src/errors.mjs";
import { NOW, response } from "./activity-helpers.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const stderr = (n) => readFileSync(fileURLToPath(new URL(`./fixtures/gh-errors/${n}.stderr.txt`, import.meta.url)), "utf8");

function fakeExec(handler) {
  const calls = [];
  const exec = async (file, args, opts) => {
    calls.push({ file, args, opts });
    return handler({ file, args, n: calls.length });
  };
  return { exec, calls };
}
const viewerOk = (args) => args.some((a) => a.includes("viewer { login }")) && !args.some((a) => a.startsWith("from="));
const ok = ({ args }) => ({ stdout: JSON.stringify(viewerOk(args) ? { data: { viewer: { login: "mbaic" } } } : response()) });

test("load runs gh with an argument array, no shell, no -F, and the validated login in the search strings", async () => {
  const { exec, calls } = fakeExec(ok);
  const loader = createActivityLoader({ exec, now: () => NOW, candidates: ["gh"] });
  const res = await loader.load({ range: "30d" });
  assert.equal(res.data.viewer.login, "mbaic");
  assert.equal(res.windows.range, "30d");
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.equal(c.file, "gh");
    assert.ok(Array.isArray(c.args));
    assert.deepEqual(c.args.slice(0, 2), ["api", "graphql"]);
    assert.ok(!c.args.includes("-F"));
    assert.ok(c.opts.timeout > 0);
  }
  assert.ok(calls[1].args.includes("qMerged=is:pr author:mbaic merged:2026-09-22T12:00:00Z..2026-10-22T12:00:00Z"));
});

test("results are cached per range, the viewer is looked up once, force refetches", async () => {
  const { exec, calls } = fakeExec(ok);
  const loader = createActivityLoader({ exec, now: () => NOW, candidates: ["gh"] });
  await loader.load({ range: "30d" });
  await loader.load({ range: "30d" });
  assert.equal(calls.length, 2);
  await loader.load({ range: "7d" });
  assert.equal(calls.length, 3);
  await loader.load({ range: "30d", force: true });
  assert.equal(calls.length, 4);
});

test("concurrent loads of one range share a request", async () => {
  const { exec, calls } = fakeExec(ok);
  const loader = createActivityLoader({ exec, now: () => NOW, candidates: ["gh"] });
  await Promise.all([loader.load({ range: "90d" }), loader.load({ range: "90d" })]);
  assert.equal(calls.length, 2);
});

test("an unknown range is rejected without calling gh", async () => {
  const { exec, calls } = fakeExec(ok);
  const res = await createActivityLoader({ exec, candidates: ["gh"] }).load({ range: "forever" });
  assert.equal(res.error.code, "bad_range");
  assert.equal(calls.length, 0);
});

test("gh missing: tries the next candidate, then reports gh_missing", async () => {
  const { exec, calls } = fakeExec(() => { throw Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }); });
  const res = await createActivityLoader({ exec, candidates: ["gh", "/usr/bin/gh"] }).load({ range: "30d" });
  assert.equal(res.error.code, "gh_missing");
  assert.equal(calls.length, 2);
});

test("not signed in and rate limit map to their states", async () => {
  const a = fakeExec(() => { throw Object.assign(new Error("x"), { stderr: "To get started with GitHub CLI, please run:  gh auth login" }); });
  assert.equal((await createActivityLoader({ exec: a.exec, candidates: ["gh"] }).load({ range: "30d" })).error.code, "gh_not_authenticated");
  const r = fakeExec(() => { throw Object.assign(new Error("x"), { stderr: stderr("rate-limit") }); });
  const res = await createActivityLoader({ exec: r.exec, candidates: ["gh"] }).load({ range: "30d" });
  assert.equal(res.error.code, "rate_limited");
  assert.equal(res.error.resetAt, "2026-09-21T14:13:20.000Z");
});

test("a failed load is not cached", async () => {
  let fail = true;
  const { exec, calls } = fakeExec((c) => { if (fail) throw Object.assign(new Error("x"), { stderr: "dial tcp: i/o timeout" }); return ok(c); });
  const loader = createActivityLoader({ exec, now: () => NOW, candidates: ["gh"] });
  assert.equal((await loader.load({ range: "30d" })).error.code, "network");
  fail = false;
  assert.ok((await loader.load({ range: "30d" })).data);
  assert.ok(calls.length >= 3);
});

test("SSO: a non-zero exit that still printed data returns the data with a partial notice", async () => {
  const body = { ...response(), errors: [{ type: "FORBIDDEN", message: "Resource protected by organization SAML enforcement." }] };
  const { exec } = fakeExec(({ args }) => {
    if (viewerOk(args)) return { stdout: JSON.stringify({ data: { viewer: { login: "mbaic" } } }) };
    throw Object.assign(new Error("exit 1"), { stdout: JSON.stringify(body), stderr: "gh: SAML" });
  });
  const res = await createActivityLoader({ exec, now: () => NOW, candidates: ["gh"] }).load({ range: "30d" });
  assert.ok(res.data.viewer.cur);
  assert.equal(res.partial[0].kind, "sso");
});

test("an invalid login from GitHub is refused before it reaches a search string", async () => {
  const { exec } = fakeExec(() => ({ stdout: JSON.stringify({ data: { viewer: { login: "bad login; rm" } } }) }));
  const res = await createActivityLoader({ exec, candidates: ["gh"] }).load({ range: "30d" });
  assert.equal(res.error.code, "unknown");
});

test("garbage output maps to a generic error", async () => {
  const { exec } = fakeExec(() => ({ stdout: "<html>" }));
  assert.equal((await createActivityLoader({ exec, candidates: ["gh"] }).load({ range: "30d" })).error.code, "unknown");
});

test("error classification fixtures", () => {
  assert.equal(classifyGhError(stderr("sso-403")).code, "forbidden");
  assert.equal(classifyGhError(stderr("not-logged-in")).code, "gh_not_authenticated");
  assert.equal(classifyGhError({ killed: true }).code, "timeout");
  assert.deepEqual(describeGraphqlErrors([{ type: "FORBIDDEN", message: "SAML" }, { message: "boom" }]).map((e) => e.kind), ["sso", "other"]);
  assert.deepEqual(describeGraphqlErrors(undefined), []);
});
