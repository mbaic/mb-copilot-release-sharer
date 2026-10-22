import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_COMMAND, chooseSelection, copyLabel, describeError,
  filterReleases, formatResetTime, mergePatch, mergeReleases, releaseChanged, shortDate,
} from "../plugins/release-sharer/com.github.copilot/extensions/release-sharer/ui/logic.js";

const R = [
  { id: 1, tag: "v2.4.1", name: "Posting preview", prerelease: false },
  { id: 2, tag: "v2.4.0-rc.1", name: "Candidate", prerelease: true },
  { id: 3, tag: "v2.3.2", name: "", prerelease: false },
];

test("filterReleases applies type filter and case-insensitive search over tag and name", () => {
  assert.equal(filterReleases(R).length, 3);
  assert.deepEqual(filterReleases(R, { filter: "stable" }).map((r) => r.tag), ["v2.4.1", "v2.3.2"]);
  assert.deepEqual(filterReleases(R, { filter: "pre" }).map((r) => r.tag), ["v2.4.0-rc.1"]);
  assert.deepEqual(filterReleases(R, { query: " POSTING " }).map((r) => r.tag), ["v2.4.1"]);
  assert.deepEqual(filterReleases(R, { query: "2.3" }).map((r) => r.tag), ["v2.3.2"]);
  assert.deepEqual(filterReleases(R, { filter: "pre", query: "posting" }), []);
});

test("chooseSelection keeps the wanted tag, else falls back to the newest and flags a vanished one", () => {
  assert.deepEqual(chooseSelection(R, "v2.3.2"), { tag: "v2.3.2", gone: false });
  assert.deepEqual(chooseSelection(R, "v9"), { tag: "v2.4.1", gone: true });
  assert.deepEqual(chooseSelection(R, null), { tag: "v2.4.1", gone: false });
  assert.deepEqual(chooseSelection([], "v1"), { tag: null, gone: false });
});

test("mergeReleases appends only unseen releases", () => {
  const merged = mergeReleases(R, [R[2], { id: 4, tag: "v2.3.1" }]);
  assert.deepEqual(merged.map((r) => r.tag), ["v2.4.1", "v2.4.0-rc.1", "v2.3.2", "v2.3.1"]);
});

test("releaseChanged compares what the preview depends on", () => {
  assert.equal(releaseChanged(R[0], { ...R[0] }), false);
  assert.equal(releaseChanged(R[0], { ...R[0], body: "x" }), true);
  assert.equal(releaseChanged(null, R[0]), true);
});

test("copy labels per format", () => {
  assert.deepEqual(["plain", "markdown", "email"].map(copyLabel), ["Copy", "Copy", "Copy email"]);
});

test("shortDate formats in UTC and tolerates junk", () => {
  assert.equal(shortDate("2026-10-09T23:30:00Z"), "9 Oct 2026");
  assert.equal(shortDate(null), "");
});

test("formatResetTime accepts seconds, milliseconds and ISO strings", () => {
  const d = new Date(2026, 9, 18, 14, 5);
  assert.equal(formatResetTime(Math.floor(d.getTime() / 1000)), "14:05");
  assert.equal(formatResetTime(d.getTime()), "14:05");
  assert.equal(formatResetTime(d.toISOString()), "14:05");
  assert.equal(formatResetTime(undefined), null);
  assert.equal(formatResetTime("soon"), null);
});

test("describeError maps every error code to a view", () => {
  assert.equal(describeError({ code: "gh_missing" }).link.href, "https://cli.github.com");
  assert.equal(describeError({ code: "gh_not_authenticated" }).command, AUTH_COMMAND);
  assert.equal(describeError({ code: "forbidden" }).changeRepo, true);
  assert.equal(describeError({ code: "repo_not_found" }).kind, "repo_not_found");
  for (const code of ["not_a_repo", "no_repo", "invalid_repo", "unsupported_host"]) assert.equal(describeError({ code }).form, true, code);
  assert.match(describeError({ code: "unsupported_host" }).title, /Enterprise Server/);
  for (const code of ["timeout", "network"]) assert.equal(describeError({ code }).title, "Could not reach GitHub");
  assert.equal(describeError({ code: "empty" }).retry, false);
  assert.equal(describeError({ code: "weird", message: "Boom" }).title, "Boom");
  assert.equal(describeError(undefined).kind, "unknown");
});

test("describeError for rate limiting carries the reset time", () => {
  const at = Math.floor(new Date(2026, 9, 18, 9, 7).getTime() / 1000);
  const v = describeError({ code: "rate_limited", resetAt: at });
  assert.match(v.title, /Resets at 09:07\./);
  assert.equal(v.retryAt, at * 1000);
  assert.equal(describeError({ code: "rate_limited" }).retryAt, null);
});

test("mergePatch deep-merges objects and replaces scalars", () => {
  const out = mergePatch({ ui: { format: "plain", clean: true }, repos: { "a/b": { lastTag: "v1" } } }, { ui: { format: "email" }, repos: { "a/b": { filter: "pre" } } });
  assert.deepEqual(out, { ui: { format: "email", clean: true }, repos: { "a/b": { lastTag: "v1", filter: "pre" } } });
});
