import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { startInstanceServer } from "../plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/src/server.mjs";
import { NOW, response, windows } from "./activity-helpers.mjs";

const extDir = fileURLToPath(new URL("../plugins/activity-sharer/com.github.copilot/extensions/activity-sharer", import.meta.url));

async function withServer(over, fn) {
  const calls = { activity: [], writeup: [] };
  const server = await startInstanceServer({
    extDir, version: "1.2.3", pingMs: 60_000,
    loadActivity: async (q) => { calls.activity.push(q); return { data: response().data, windows: windows(q.range), fetchedAt: NOW.toISOString() }; },
    writeup: async (r) => { calls.writeup.push(r); },
    log: { error() {} },
    ...over,
  });
  try { await fn(server, calls, new URL(server.url).origin); } finally { await server.stop(); }
}
const post = (url, body, headers = {}) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("serves the page, the UI files and the allow-listed lib modules with a strict CSP", async () => {
  await withServer({}, async (s) => {
    const page = await fetch(s.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Activity Sharer/);
    const csp = page.headers.get("content-security-policy");
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self'/);
    for (const f of ["ui/app.js", "ui/api.js", "ui/logic.js", "ui/clipboard.js", "ui/styles.css", "lib/aggregate.mjs", "lib/agent.mjs", "lib/summary.mjs", "lib/evidence.mjs"]) {
      assert.equal((await fetch(`${s.url}${f}`)).status, 200, f);
    }
  });
});

test("lib files outside the allow-list, traversal and unknown paths are 404", async () => {
  await withServer({}, async (s, _c, base) => {
    for (const f of ["lib/query.mjs", "lib/writeup.mjs", "src/server.mjs", "package.json", "ui/../package.json", "ui/nope.js"]) {
      assert.equal((await fetch(`${s.url}${f}`)).status, 404, f);
    }
    assert.equal((await fetch(`${base}/wrong-token/`)).status, 404);
    assert.equal((await fetch(`${base}/`)).status, 404);
  });
});

test("api/activity passes range and force through and returns the loader result", async () => {
  await withServer({}, async (s, calls) => {
    const res = await (await fetch(`${s.url}api/activity?range=7d&force=1`)).json();
    assert.equal(res.data.viewer.login, "mbaic");
    assert.deepEqual(calls.activity[0], { range: "7d", force: true });
    await fetch(`${s.url}api/activity`);
    assert.deepEqual(calls.activity[1], { range: "30d", force: false });
  });
});

test("api/state reports the version", async () => {
  await withServer({}, async (s) => {
    assert.deepEqual(await (await fetch(`${s.url}api/state`)).json(), { version: "1.2.3", features: { writeup: true } });
  });
});

test("api/writeup validates its body, origin and content type", async () => {
  await withServer({}, async (s, calls) => {
    assert.equal((await (await post(`${s.url}api/writeup`, { audience: "standup", range: "30d", orgs: ["mbaic"] })).json()).ok, true);
    assert.deepEqual(calls.writeup[0], { audience: "standup", range: "30d", orgs: ["mbaic"] });
    assert.equal((await post(`${s.url}api/writeup`, { audience: 5, range: "30d" })).status, 400);
    assert.equal((await post(`${s.url}api/writeup`, { audience: "standup", range: "30d", orgs: ["a b"] })).status, 400);
    assert.equal((await post(`${s.url}api/writeup`, { audience: "standup", range: "30d", orgs: "mbaic" })).status, 400);
    assert.equal((await post(`${s.url}api/writeup`, { audience: "standup", range: "30d" }, { Origin: "https://evil.example" })).status, 403);
    const text = await fetch(`${s.url}api/writeup`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
    assert.equal(text.status, 415);
    // Over the body cap the server drops the connection; either a 413 or a reset counts as refused.
    const big = await post(`${s.url}api/writeup`, { audience: "x".repeat(20_000), range: "30d" }).catch(() => ({ status: 413 }));
    assert.equal(big.status, 413);
    assert.equal(calls.writeup.length, 1);
  });
});

test("a failing agent round trip is reported as agent_unreachable", async () => {
  await withServer({ writeup: async () => { throw new Error("no session"); } }, async (s) => {
    const body = await (await post(`${s.url}api/writeup`, { audience: "standup", range: "30d" })).json();
    assert.equal(body.error.code, "agent_unreachable");
  });
});

test("events stream delivers broadcast drafts", async () => {
  await withServer({}, async (s) => {
    const res = await fetch(`${s.url}events`);
    const reader = res.body.getReader();
    await reader.read(); // retry hint
    s.broadcast("draft", { audience: "client", text: "hi" });
    const { value } = await reader.read();
    assert.match(new TextDecoder().decode(value), /event: draft\ndata: \{"audience":"client","text":"hi"\}/);
    await reader.cancel();
  });
});

test("wrong host header is refused", async () => {
  await withServer({}, async (s) => {
    const { request } = await import("node:http");
    const u = new URL(s.url);
    const status = await new Promise((resolve, reject) => {
      const r = request({ host: "127.0.0.1", port: u.port, path: u.pathname, headers: { Host: "evil.example" } }, (res) => { res.resume(); resolve(res.statusCode); });
      r.on("error", reject);
      r.end();
    });
    assert.equal(status, 421);
  });
});
