import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_COMMAND, MAIL_TRUNCATION_NOTE, buildMailto, chooseSelection, clipboardText, copyLabel, describeError,
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

test("buildMailto encodes with CRLF line breaks and leaves short bodies alone", () => {
  const { url, truncated } = buildMailto("[a/b] v1 released", "Hi all,\n\nv1 & more");
  assert.equal(truncated, false);
  assert.equal(url, "mailto:?subject=%5Ba%2Fb%5D%20v1%20released&body=Hi%20all%2C%0D%0A%0D%0Av1%20%26%20more");
});

test("buildMailto cuts at a line boundary, adds the note and stays within 1800 characters", () => {
  const body = Array.from({ length: 200 }, (_, i) => `- line ${i} with some words`).join("\n");
  const { url, truncated } = buildMailto("Subject", body);
  assert.equal(truncated, true);
  assert.ok(url.length <= 1800, String(url.length));
  const decoded = decodeURIComponent(url.split("&body=")[1]).replace(/\r\n/g, "\n");
  assert.ok(decoded.endsWith(MAIL_TRUNCATION_NOTE));
  const kept = decoded.split("\n\n")[0].split("\n");
  assert.ok(kept.length > 10 && kept.every((l, i) => l === `- line ${i} with some words`), "whole lines only");
  assert.ok(buildMailto("Subject", body, 2000).url.length > url.length, "a larger limit keeps more lines");
});

test("buildMailto copes with a subject that alone exceeds the limit", () => {
  const { url, truncated } = buildMailto("s".repeat(3000), "a\nb");
  assert.equal(truncated, true);
  assert.ok(url.includes(encodeURIComponent(MAIL_TRUNCATION_NOTE)));
});

test("copy labels and clipboard text per format", () => {
  assert.deepEqual(["plain", "markdown", "email", "html"].map(copyLabel), ["Copy", "Copy", "Copy email", "Copy rich text"]);
  assert.equal(clipboardText("email", { subject: "S", text: "B" }), "Subject: S\n\nB");
  assert.equal(clipboardText("plain", { subject: "S", text: "B" }), "B");
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
