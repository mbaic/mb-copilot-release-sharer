import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createState, defaultStatePath } from "../plugins/release-sharer/com.github.copilot/extensions/release-sharer/src/state.mjs";

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rs-state-")), "sub", "state.json");

/** Manual timers: setTimer records, fire() runs the pending callback. */
function fakeTimers() {
  let next = 1;
  const pending = new Map();
  return {
    setTimer: (fn, ms) => { const id = next++; pending.set(id, { fn, ms }); return id; },
    clearTimer: (id) => pending.delete(id),
    pending,
    fire() { const [[id, t]] = pending; pending.delete(id); t.fn(); },
  };
}

const DEFAULT_UI = { listWidth: 300, listCollapsed: false, format: "plain", clean: true, contributors: true, link: true, audience: "Customers" };

test("defaults when the file is missing", () => {
  const s = createState({ file: tmpFile() });
  assert.deepEqual(s.get(), { v: 1, ui: DEFAULT_UI, repos: {}, workdirs: {} });
});

test("get returns a copy", () => {
  const s = createState({ file: tmpFile() });
  s.get().ui.format = "html";
  assert.equal(s.get().ui.format, "plain");
});

test("patch deep-merges and ignores unknown keys", () => {
  const s = createState({ file: tmpFile(), ...fakeTimers() });
  s.patch({ ui: { format: "email", nope: 1 }, bogus: {}, v: 9, repos: { "acme/bc-app": { lastTag: "v1", filter: "pre", junk: true } } });
  s.patch({ repos: { "acme/bc-app": { filter: "stable" } } });
  const st = s.get();
  assert.equal(st.v, 1);
  assert.equal(st.ui.format, "email");
  assert.equal(st.ui.clean, true);
  assert.equal("nope" in st.ui, false);
  assert.equal("bogus" in st, false);
  assert.deepEqual(st.repos, { "acme/bc-app": { lastTag: "v1", filter: "stable" } });
});

test("patch rejects invalid types and values, keeping the old value", () => {
  const s = createState({ file: tmpFile(), ...fakeTimers() });
  s.patch({ ui: { listWidth: "wide", listCollapsed: "yes", format: "pdf", clean: 1, contributors: null, link: "x", audience: "Everyone" } });
  s.patch({ repos: { "not a repo": { lastTag: "v1" }, "a/b": { filter: "nope", lastTag: 5 }, __proto__: { lastTag: "x" } } });
  s.patch({ workdirs: { "/w": { repoOverride: "bad repo" } } });
  s.patch("garbage");
  s.patch(null);
  assert.deepEqual(s.get(), { v: 1, ui: DEFAULT_UI, repos: {}, workdirs: {} });
});

test("listWidth is clamped and rounded; NaN rejected", () => {
  const s = createState({ file: tmpFile(), ...fakeTimers() });
  s.patch({ ui: { listWidth: 10 } });
  assert.equal(s.get().ui.listWidth, 220);
  s.patch({ ui: { listWidth: 1e9 } });
  assert.equal(s.get().ui.listWidth, 4000);
  s.patch({ ui: { listWidth: 333.6 } });
  assert.equal(s.get().ui.listWidth, 334);
  s.patch({ ui: { listWidth: NaN } });
  assert.equal(s.get().ui.listWidth, 334);
});

test("repo overrides: validate, get, clear", () => {
  const s = createState({ file: tmpFile(), ...fakeTimers() });
  assert.equal(s.getRepoOverride("/w"), null);
  assert.equal(s.setRepoOverride("/w", "acme/bc-app"), true);
  assert.equal(s.getRepoOverride("/w"), "acme/bc-app");
  assert.equal(s.setRepoOverride("/w", "x y/z"), false);
  assert.equal(s.setRepoOverride("/w", "a/b;c"), false);
  assert.equal(s.getRepoOverride("/w"), "acme/bc-app");
  assert.equal(s.setRepoOverride("/w", null), true);
  assert.equal(s.getRepoOverride("/w"), null);
});

test("debounce: one write 300 ms after the last patch (fake timers)", async () => {
  const file = tmpFile();
  const t = fakeTimers();
  const s = createState({ file, setTimer: t.setTimer, clearTimer: t.clearTimer });
  s.patch({ ui: { clean: false } });
  s.patch({ ui: { link: false } });
  assert.equal(t.pending.size, 1);
  assert.equal([...t.pending.values()][0].ms, 300);
  assert.equal(fs.existsSync(file), false);
  t.fire();
  await s.flush();
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(saved.ui.clean, false);
  assert.equal(saved.ui.link, false);
  assert.equal(createState({ file }).get().ui.clean, false);
});

test("flush writes immediately, cancels the timer and is a no-op when clean", async () => {
  const file = tmpFile();
  const t = fakeTimers();
  const s = createState({ file, setTimer: t.setTimer, clearTimer: t.clearTimer });
  await s.flush();
  assert.equal(fs.existsSync(file), false);
  s.patch({ ui: { format: "html" } });
  await s.flush();
  assert.equal(t.pending.size, 0);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).ui.format, "html");
});

test("atomic write: tmp file then rename, mode 0600, no tmp left", async () => {
  const file = tmpFile();
  const ops = [];
  const p = fs.promises;
  const fsImpl = {
    readFileSync: fs.readFileSync, renameSync: fs.renameSync,
    promises: {
      mkdir: p.mkdir, chmod: p.chmod,
      writeFile: async (f, ...a) => { ops.push(["write", path.basename(f)]); return p.writeFile(f, ...a); },
      rename: async (a, b) => { ops.push(["rename", path.basename(a), path.basename(b)]); return p.rename(a, b); },
    },
  };
  const s = createState({ file, fsImpl, ...fakeTimers() });
  s.patch({ ui: { clean: false } });
  await s.flush();
  assert.deepEqual(ops, [["write", "state.json.tmp"], ["rename", "state.json.tmp", "state.json"]]);
  assert.equal(fs.existsSync(`${file}.tmp`), false);
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("a failing chmod does not fail the write", async () => {
  const file = tmpFile();
  const fsImpl = { ...fs, promises: { ...fs.promises, chmod: async () => { throw new Error("EPERM"); } } };
  const s = createState({ file, fsImpl, ...fakeTimers() });
  s.patch({ ui: { clean: false } });
  await s.flush();
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).ui.clean, false);
});

test("corrupt file is moved to .bak and defaults are used", () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{ not json");
  const s = createState({ file });
  assert.deepEqual(s.get().ui, DEFAULT_UI);
  assert.equal(fs.readFileSync(`${file}.bak`, "utf8"), "{ not json");
  assert.equal(fs.existsSync(file), false);
});

test("stored values are validated on load", () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    v: 1, extra: 1,
    ui: { listWidth: 5, format: "email", clean: "no", unknown: 1 },
    repos: { "acme/bc-app": { lastTag: "v2", filter: "stable" }, "bad key": { lastTag: "x" } },
    workdirs: { "/w": { repoOverride: "o/r" }, "/x": { repoOverride: "nope nope" } },
  }));
  const st = createState({ file }).get();
  assert.equal(st.ui.listWidth, 220);
  assert.equal(st.ui.format, "email");
  assert.equal(st.ui.clean, true);
  assert.deepEqual(st.repos, { "acme/bc-app": { lastTag: "v2", filter: "stable" } });
  assert.deepEqual(st.workdirs, { "/w": { repoOverride: "o/r" } });
});

test("a JSON array or scalar file counts as corrupt-free defaults", () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "[1,2]");
  assert.deepEqual(createState({ file }).get().ui, DEFAULT_UI);
});

test("defaultStatePath honours COPILOT_HOME", () => {
  const old = process.env.COPILOT_HOME;
  try {
    process.env.COPILOT_HOME = path.join(os.tmpdir(), "chome");
    assert.equal(defaultStatePath(), path.join(os.tmpdir(), "chome", "extensions", "release-sharer", "state.json"));
    delete process.env.COPILOT_HOME;
    assert.equal(defaultStatePath(), path.join(os.homedir(), ".copilot", "extensions", "release-sharer", "state.json"));
  } finally {
    if (old === undefined) delete process.env.COPILOT_HOME; else process.env.COPILOT_HOME = old;
  }
});
