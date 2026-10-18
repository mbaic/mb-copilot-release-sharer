import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startInstanceServer } from "../plugins/release-sharer/com.github.copilot/extensions/release-sharer/src/server.mjs";

function fakeExt() {
  const dir = mkdtempSync(path.join(tmpdir(), "rs-ext-"));
  mkdirSync(path.join(dir, "ui"));
  mkdirSync(path.join(dir, "lib"));
  writeFileSync(path.join(dir, "ui", "index.html"), "<!doctype html><title>x</title>");
  writeFileSync(path.join(dir, "ui", "app.js"), "export {};");
  writeFileSync(path.join(dir, "ui", "secret.js"), "nope");
  writeFileSync(path.join(dir, "lib", "model.mjs"), "export {};");
  return dir;
}

async function setup(over = {}) {
  const calls = { patch: [], rewrite: [], repo: [] };
  const st = { ui: { format: "plain" }, repos: {} };
  const deps = {
    extDir: fakeExt(), version: "0.0.0", features: { rewrite: true }, pingMs: 30,
    getRepo: () => ({ repo: "acme/app" }),
    setRepo: async (r) => { calls.repo.push(r); return { repo: r }; },
    state: { get: () => st, patch: (p) => { calls.patch.push(p); Object.assign(st.ui, p.ui ?? {}); return st; } },
    loadReleases: async ({ page }) => ({ releases: [{ tag: "v1" }], hasMore: false, page }),
    rewrite: async (r) => { calls.rewrite.push(r); },
    ...over,
  };
  const srv = await startInstanceServer(deps);
  return { srv, calls, base: srv.url.replace(/\/$/, ""), host: `127.0.0.1:${srv.port}` };
}

function req(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
    });
    r.on("error", reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
}
const json = (o) => JSON.stringify(o);
const J = { "content-type": "application/json" };

test("binds to loopback with a token and serves the page with security headers", async () => {
  const { srv, base } = await setup();
  try {
    assert.match(srv.url, /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{32}\/$/);
    const r = await req(base + "/");
    assert.equal(r.status, 200);
    assert.match(r.headers["content-security-policy"], /default-src 'none'/);
    assert.match(r.headers["content-security-policy"], /style-src-attr 'unsafe-inline'/);
    assert.equal(r.headers["x-content-type-options"], "nosniff");
    assert.equal(r.headers["cache-control"], "no-store");
    assert.equal((await req(base + "/ui/app.js")).headers["content-type"], "text/javascript; charset=utf-8");
  } finally { await srv.stop(); }
});

test("wrong token and non-allow-listed files get 404", async () => {
  const { srv, base, host } = await setup();
  try {
    assert.equal((await req(`http://${host}/wrong/api/state`)).status, 404);
    assert.equal((await req(`http://${host}/`)).status, 404);
    assert.equal((await req(base + "/ui/secret.js")).status, 404);
    for (const p of ["/ui/../src/server.mjs", "/ui/%2e%2e/src/server.mjs", "/lib/..%2fsrc%2fserver.mjs", "/ui/%2e%2e%2fsrc"]) {
      assert.equal((await req(base + p)).status, 404, p);
    }
  } finally { await srv.stop(); }
});

test("wrong Host header gets 421", async () => {
  const { srv, base } = await setup();
  try {
    assert.equal((await req(base + "/api/state", { headers: { host: "evil.example" } })).status, 421);
  } finally { await srv.stop(); }
});

test("POST guards: origin, content type, size", async () => {
  const { srv, base } = await setup();
  try {
    const body = json({ patch: { ui: { format: "email" } } });
    assert.equal((await req(base + "/api/state", { method: "POST", headers: { ...J, origin: "http://evil.example" }, body })).status, 403);
    assert.equal((await req(base + "/api/state", { method: "POST", headers: { "content-type": "text/plain" }, body })).status, 415);
    const big = json({ patch: { x: "a".repeat(70 * 1024) } });
    assert.equal((await req(base + "/api/state", { method: "POST", headers: J, body: big }).catch(() => ({ status: 413 }))).status, 413);
    const ok = await req(base + "/api/state", { method: "POST", headers: { ...J, origin: `http://127.0.0.1:${srv.port}` }, body });
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.text).prefs.format, "email");
  } finally { await srv.stop(); }
});

test("state, repo and releases routes", async () => {
  const { srv, base, calls } = await setup();
  try {
    const s = JSON.parse((await req(base + "/api/state")).text);
    assert.deepEqual([s.repo, s.version, s.features.rewrite], ["acme/app", "0.0.0", true]);
    const rel = JSON.parse((await req(base + "/api/releases?page=2")).text);
    assert.equal(rel.page, 2);
    const r = JSON.parse((await req(base + "/api/repo", { method: "POST", headers: J, body: json({ repo: "a/b" }) })).text);
    assert.equal(r.repo, "a/b");
    assert.deepEqual(calls.repo, ["a/b"]);
    assert.equal((await req(base + "/api/nope")).status, 404);
  } finally { await srv.stop(); }
});

test("rewrite route calls deps.rewrite and maps failures to an error object", async () => {
  const { srv, base, calls } = await setup();
  try {
    const ok = JSON.parse((await req(base + "/api/rewrite", { method: "POST", headers: J, body: json({ tag: "v1", audience: "Customers", format: "plain" }) })).text);
    assert.deepEqual(ok, { ok: true });
    assert.equal(calls.rewrite[0].tag, "v1");
  } finally { await srv.stop(); }
  const bad = await setup({ rewrite: async () => { throw new Error("boom"); } });
  try {
    const r = await req(bad.base + "/api/rewrite", { method: "POST", headers: J, body: json({ tag: "v1", audience: "Internal" }) });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.text).error.code, "agent_unreachable");
  } finally { await bad.srv.stop(); }
});

test("SSE streams broadcast and ping; stop closes them", async () => {
  const { srv, base } = await setup();
  const events = [];
  await new Promise((resolve, reject) => {
    const r = http.get(base + "/events", (res) => {
      assert.match(res.headers["content-type"], /text\/event-stream/);
      res.on("data", (c) => {
        events.push(c.toString());
        const all = events.join("");
        if (!all.includes("event: select")) srv.broadcast("select", { tag: "v1" });
        if (all.includes("event: select") && all.includes("event: ping")) { r.destroy(); resolve(); }
      });
    });
    r.on("error", (e) => (e.code === "ECONNRESET" ? resolve() : reject(e)));
  });
  await srv.stop();
  assert.match(events.join(""), /data: \{"tag":"v1"\}/);
});
