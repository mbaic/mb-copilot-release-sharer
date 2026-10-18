// Pure UI helpers: no DOM access, so they run under node:test (PLAN section 11).

export const FILTERS = ["all", "stable", "pre"];
export const MAIL_URL_LIMIT = 1800;
export const MAIL_TRUNCATION_NOTE = "[Truncated, paste the full text from the clipboard]";
export const AUTH_COMMAND = "gh auth login";

/** Releases matching the All/Stable/Pre-release filter and a case-insensitive search over tag and name. */
export function filterReleases(releases, { filter = "all", query = "" } = {}) {
  const q = String(query).trim().toLowerCase();
  return releases.filter((r) => {
    if (filter === "stable" && r.prerelease) return false;
    if (filter === "pre" && !r.prerelease) return false;
    return !q || String(r.tag ?? "").toLowerCase().includes(q) || String(r.name ?? "").toLowerCase().includes(q);
  });
}

/** Which release to select: the wanted tag if present, else the newest. `gone` is true when a wanted tag vanished. */
export function chooseSelection(releases, wantedTag) {
  if (!releases.length) return { tag: null, gone: false };
  if (wantedTag && releases.some((r) => r.tag === wantedTag)) return { tag: wantedTag, gone: false };
  return { tag: releases[0].tag, gone: Boolean(wantedTag) };
}

/** Appends a page of releases, de-duplicated by id (falling back to tag). */
export function mergeReleases(existing, incoming) {
  const key = (r) => r.id ?? r.tag;
  const seen = new Set(existing.map(key));
  return [...existing, ...incoming.filter((r) => !seen.has(key(r)))];
}

/** True when two mapped releases would produce a different preview. */
export function releaseChanged(a, b) {
  if (!a || !b) return true;
  return ["body", "name", "prerelease", "latest", "url", "publishedAt"].some((k) => a[k] !== b[k]);
}

/** mailto: URL per PLAN 8.3. Cuts the body at a line boundary so the URL stays within `limit`. */
export function buildMailto(subject, body, limit = MAIL_URL_LIMIT) {
  const make = (text) =>
    `mailto:?subject=${encodeURIComponent(subject)}&body=${text.split("\n").map(encodeURIComponent).join("%0D%0A")}`;
  const full = make(body);
  if (full.length <= limit) return { url: full, truncated: false };
  const lines = body.split("\n");
  const attempt = (n) => make([...lines.slice(0, n), "", MAIL_TRUNCATION_NOTE].join("\n"));
  let lo = 0;
  let hi = lines.length - 1; // the URL only grows with n, so binary search for the most lines that fit
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (attempt(mid).length <= limit) lo = mid;
    else hi = mid - 1;
  }
  return { url: attempt(lo), truncated: true };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "9 Oct 2026" (UTC) for list rows; "" when the date is missing or invalid. Cheaper than building a full model. */
export function shortDate(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Label of the primary copy button. */
export function copyLabel(format) {
  return format === "email" ? "Copy email" : format === "html" ? "Copy rich text" : "Copy";
}

/** Text put on the clipboard for the plain-text formats; the email form carries its subject. */
export function clipboardText(format, { subject = "", text = "" }) {
  return format === "email" ? `Subject: ${subject}\n\n${text}` : text;
}

/** Epoch ms of a rate-limit reset given as epoch seconds, epoch ms or an ISO string; null when unknown. */
export function resetMs(resetAt) {
  if (typeof resetAt === "number" && Number.isFinite(resetAt)) return resetAt < 1e12 ? resetAt * 1000 : resetAt;
  if (typeof resetAt === "string" && resetAt.trim()) {
    const n = Number(resetAt);
    if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
    const t = Date.parse(resetAt);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** "HH:MM" local time of a rate-limit reset, or null. */
export function formatResetTime(resetAt) {
  const ms = resetMs(resetAt);
  if (ms === null) return null;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Maps an API error (or the "no repo" / "empty" conditions) to what the state panel shows.
 * @returns {{ kind:string, title:string, detail:string, form:boolean, retry:boolean, retryAt:number|null,
 *   command:string|null, link:{href:string,text:string}|null, changeRepo:boolean }}
 */
export function describeError(error) {
  const e = error ?? {};
  const base = { detail: "", form: false, retry: false, retryAt: null, command: null, link: null, changeRepo: false };
  switch (e.code) {
    case "not_a_repo":
    case "no_repo":
      return { ...base, kind: "no_repo", title: "Could not detect a GitHub repository for this session", form: true };
    case "invalid_repo":
      return { ...base, kind: "invalid_repo", title: "That doesn't look like owner/repo", detail: "Use the form owner/repo, for example acme/bc-app.", form: true };
    case "unsupported_host":
      return { ...base, kind: "unsupported_host", title: "GitHub Enterprise Server isn't supported yet", detail: "Only github.com repositories work for now. You can enter one by hand.", form: true };
    case "gh_missing":
      return { ...base, kind: "gh_missing", title: "GitHub CLI (gh) was not found", detail: "Install it, then retry.", link: { href: "https://cli.github.com", text: "cli.github.com" }, retry: true };
    case "gh_not_authenticated":
      return { ...base, kind: "gh_not_authenticated", title: "GitHub CLI is not signed in", detail: "Run this in a terminal, then Retry.", command: AUTH_COMMAND, retry: true };
    case "repo_not_found":
    case "forbidden":
      return { ...base, kind: "repo_not_found", title: "Repository not found or you don't have access", changeRepo: true, retry: true };
    case "rate_limited": {
      const at = formatResetTime(e.resetAt);
      return { ...base, kind: "rate_limited", title: `GitHub rate limit reached.${at ? ` Resets at ${at}.` : ""}`, detail: "Retry becomes available when the limit resets.", retry: true, retryAt: resetMs(e.resetAt) };
    }
    case "timeout":
    case "network":
      return { ...base, kind: "network", title: "Could not reach GitHub", detail: "Check your connection, then retry.", retry: true };
    case "empty":
      return { ...base, kind: "empty", title: "This repository has no published releases yet" };
    default:
      return { ...base, kind: "unknown", title: e.message || "Something went wrong", detail: e.hint || "", retry: true };
  }
}

/** Deep-merges plain objects (arrays and scalars replace); used to coalesce pending pref patches. */
export function mergePatch(target, patch) {
  const out = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    const isObj = v && typeof v === "object" && !Array.isArray(v);
    out[k] = isObj && out[k] && typeof out[k] === "object" ? mergePatch(out[k], v) : v;
  }
  return out;
}
