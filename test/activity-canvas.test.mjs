import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRuntime } from "../plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/src/canvas.mjs";
import { NOW, response, windows } from "./activity-helpers.mjs";

const extDir = fileURLToPath(new URL("../plugins/activity-sharer/com.github.copilot/extensions/activity-sharer", import.meta.url));

function setup(over = {}) {
  const broadcasts = [];
  const sent = [];
  const stopped = [];
  const loads = [];
  let serverDeps;
  const loader = over.loader ?? { async load(q) { loads.push(q); return { data: response().data, windows: windows(q.range), fetchedAt: NOW.toISOString() }; } };
  const rt = createRuntime(() => ({ send: async (m) => sent.push(m) }), {
    loader,
    log: { error() {}, warn() {}, info() {} },
    extDir,
    version: "9.9.9",
    now: () => NOW,
    startInstanceServer: async (d) => {
      serverDeps = d;
      return { url: "http://127.0.0.1:1/t/", broadcast: (e, data) => broadcasts.push([e, data]), stop: async () => stopped.push(1) };
    },
  });
  const act = (name) => rt.canvas.actions.find((a) => a.name === name).handler;
  const ctx = (input = {}, extra = {}) => ({ instanceId: "i1", sessionId: "s1", input, ...extra });
  return { rt, act, ctx, broadcasts, sent, stopped, loads, get serverDeps() { return serverDeps; } };
}

test("canvas definition and open/onClose lifecycle", async () => {
  const t = setup();
  assert.equal(t.rt.canvas.id, "activity-sharer");
  assert.deepEqual(t.rt.canvas.actions.map((a) => a.name), ["get_activity", "set_draft"]);
  const a = await t.rt.canvas.open(t.ctx());
  const b = await t.rt.canvas.open(t.ctx());
  assert.deepEqual(a, { title: "Activity Sharer", status: "v9.9.9", url: "http://127.0.0.1:1/t/" });
  assert.deepEqual(b, a);
  await t.rt.canvas.onClose(t.ctx());
  await t.rt.canvas.onClose(t.ctx());
  assert.equal(t.stopped.length, 1);
});

test("get_activity returns compact JSON with a summary and the requested range and organizations", async () => {
  const t = setup();
  const out = await t.act("get_activity")(t.ctx({ range: "90d", orgs: ["mbaic"] }));
  assert.equal(t.loads[0].range, "90d");
  assert.deepEqual(out.organizations, ["mbaic"]);
  assert.equal(out.counts.prsMerged.count, 5);
  assert.match(out.summary.headline, /^You merged 5 pull requests/);
  assert.ok(out.merged.every((i) => i.url.startsWith("https://github.com/mbaic/")));
});

test("get_activity accepts several organizations, and the single org form", async () => {
  const t = setup();
  const both = await t.act("get_activity")(t.ctx({ orgs: ["mbaic", "contoso"] }));
  assert.equal(both.organizations, "all"); // all known orgs selected = no filter
  assert.equal(both.counts.prsMerged.count, 11);
  const one = await t.act("get_activity")(t.ctx({ org: "contoso" }));
  assert.deepEqual(one.organizations, ["contoso"]);
  assert.equal(one.counts.prsMerged.count, 6);
  await assert.rejects(t.act("get_activity")(t.ctx({ orgs: "mbaic" })), /orgs must be a list/);
  await assert.rejects(t.act("get_activity")(t.ctx({ orgs: Array(51).fill("a") })), /orgs must be a list/);
});

test("get_activity defaults to 30 days and validates input", async () => {
  const t = setup();
  await t.act("get_activity")(t.ctx());
  assert.equal(t.loads[0].range, "30d");
  await assert.rejects(t.act("get_activity")(t.ctx({ range: "forever" })), /range must be one of/);
  await assert.rejects(t.act("get_activity")(t.ctx({ org: "a b; c" })), /orgs must be a list of GitHub logins/);
});

test("get_activity surfaces partial (SSO) errors and load errors", async () => {
  const partial = setup({ loader: { async load() { return { data: response().data, windows: windows(), partial: [{ kind: "sso", message: "SAML" }] }; } } });
  assert.deepEqual((await partial.act("get_activity")(partial.ctx())).partialErrors, [{ kind: "sso", message: "SAML" }]);
  const failing = setup({ loader: { async load() { return { error: { code: "gh_missing", message: "GitHub CLI (gh) was not found.", hint: "Install it." } }; } } });
  await assert.rejects(failing.act("get_activity")(failing.ctx()), /GitHub CLI \(gh\) was not found\. Install it\./);
});

test("set_draft broadcasts the sanitized text to the session's canvases only", async () => {
  const t = setup();
  await t.rt.canvas.open(t.ctx());
  await t.act("set_draft")(t.ctx({ audience: "standup", text: " Done: 11 PRs\u0000 " }));
  assert.deepEqual(t.broadcasts, [["draft", { audience: "standup", text: "Done: 11 PRs" }]]);
  await assert.rejects(t.act("set_draft")(t.ctx({ audience: "standup", text: "x" }, { sessionId: "other" })), /not open/);
});

test("set_draft rejects unknown audiences and bad text", async () => {
  const t = setup();
  await t.rt.canvas.open(t.ctx());
  await assert.rejects(t.act("set_draft")(t.ctx({ audience: "press", text: "x" })), /audience must be one of/);
  await assert.rejects(t.act("set_draft")(t.ctx({ audience: "client", text: "" })), /must not be empty/);
  await assert.rejects(t.act("set_draft")(t.ctx({ audience: "client", text: "x".repeat(4001) })), /too long/);
  assert.equal(t.broadcasts.length, 0);
});

test("the write-up button sends the fenced prompt to the agent session", async () => {
  const t = setup();
  await t.rt.canvas.open(t.ctx());
  await t.serverDeps.writeup({ audience: "review", range: "30d", orgs: [] });
  assert.equal(t.sent.length, 1);
  assert.equal(t.sent[0].mode, "immediate");
  assert.match(t.sent[0].prompt, /<<<ACTIVITY_DATA/);
  assert.match(t.sent[0].displayPrompt, /1:1 or self-review/);
  await assert.rejects(t.serverDeps.writeup({ audience: "press", range: "30d", orgs: [] }), /Unknown audience/);
});

test("the server dependency loads activity through the loader", async () => {
  const t = setup();
  await t.rt.canvas.open(t.ctx());
  const res = await t.serverDeps.loadActivity({ range: "7d", force: true });
  assert.ok(res.data);
  assert.deepEqual(t.loads[0], { range: "7d", force: true });
});
