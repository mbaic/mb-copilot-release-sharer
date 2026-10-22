import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "../plugins/release-sharer/com.github.copilot/extensions/release-sharer/src/log.mjs";

function captureStderr(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...a) => lines.push(a.join(" "));
  try { fn(); } finally { console.error = orig; }
  return lines;
}

test("uses session.log with the level", () => {
  const calls = [];
  const log = createLogger(() => ({ log: (m, o) => calls.push([m, o]) }));
  log.info("hello");
  log.warn("w");
  log.error("e");
  assert.deepEqual(calls, [["hello", { level: "info" }], ["w", { level: "warning" }], ["e", { level: "error" }]]);
});

test("falls back to console.error when there is no session or no log function", () => {
  assert.equal(captureStderr(() => createLogger(() => undefined).info("a")).length, 1);
  assert.equal(captureStderr(() => createLogger(() => ({ log: "nope" })).info("a")).length, 1);
});

test("falls back when session.log throws or rejects", async () => {
  assert.equal(captureStderr(() => createLogger(() => ({ log() { throw new Error("x"); } })).error("boom")).length, 1);
  const lines = [];
  const orig = console.error;
  console.error = (...a) => lines.push(a.join(" "));
  try {
    createLogger(() => ({ log: () => Promise.reject(new Error("x")) })).error("late");
    await new Promise((r) => setImmediate(r));
  } finally { console.error = orig; }
  assert.equal(lines.length, 1);
});

test("truncates to 500 characters and redacts tokens", () => {
  const seen = [];
  const log = createLogger(() => ({ log: (m) => seen.push(m) }));
  log.info("x".repeat(900));
  log.info("token ghp_" + "a".repeat(36) + " end");
  assert.equal(seen[0].length, 500);
  assert.doesNotMatch(seen[1], /ghp_/);
});
