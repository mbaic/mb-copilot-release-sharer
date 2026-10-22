// Pure UI helpers (tested without a DOM).
export const RANGES = [
  ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["90d", "Last quarter"], ["6m", "Last 6 months"], ["12m", "Last 12 months"],
];
export const AUDIENCE_BUTTONS = [["standup", "Standup"], ["review", "1:1 or self-review"], ["client", "Client update"]];
const AUTH_COMMAND = "gh auth login";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-20" or full ISO -> "Oct 20". */
export function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : "";
}

/** "Sep 22 – Oct 21, 2026" for a {from,to} window. */
export function windowLabel(w) {
  const a = /^(\d{4})/.exec(w.from)?.[1];
  const b = /^(\d{4})/.exec(w.to)?.[1];
  return `${shortDate(w.from)}${a !== b ? `, ${a}` : ""} – ${shortDate(w.to)}, ${b}`;
}

/** Delta against the previous window: { cls, text } or null when there is nothing to compare. */
export function deltaView(count, prev) {
  if (prev == null) return null;
  if (count > prev) return { cls: "up", text: `▲ ${count - prev} vs previous` };
  if (count < prev) return { cls: "down", text: `▼ ${prev - count} vs previous` };
  return { cls: "same", text: "● same as previous" };
}

/** "3 days", "1 day", "today" for an age in whole days. */
export function ageLabel(days) {
  if (days <= 0) return "today";
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** Only http(s) URLs become links. */
export function safeHref(u) {
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Y-axis ticks 0..max in three equal integer steps. */
export function niceTicks(maxValue) {
  const step = Math.max(1, Math.ceil(maxValue / 3));
  return [0, step, step * 2, step * 3];
}

/** What the evidence-check banner says. */
export function checkView(result) {
  if (result.ok) return { cls: "ok", title: "Checked against your data: every link and number matches.", items: [] };
  const n = result.issues.length;
  return { cls: "bad", title: `Check before you copy: ${n} ${n === 1 ? "item doesn't" : "items don't"} match your data.`, items: result.issues.map((i) => `${i.text}: ${i.message}`) };
}

/** Maps a server error to what the panel shows. */
export function describeError(error) {
  const e = error ?? {};
  const base = { detail: "", command: null, link: null, retry: true };
  switch (e.code) {
    case "gh_missing":
      return { ...base, title: "GitHub CLI (gh) was not found", detail: "Install it, then retry.", link: { href: "https://cli.github.com", text: "cli.github.com" } };
    case "gh_not_authenticated":
      return { ...base, title: "GitHub CLI is not signed in", detail: "Run this in a terminal, then Retry.", command: AUTH_COMMAND };
    case "forbidden":
      return { ...base, title: "GitHub denied access", detail: "If your organization uses SSO, run `gh auth refresh`, then Retry." };
    case "rate_limited":
      return { ...base, title: "GitHub rate limit reached", detail: "Retry once the limit resets." };
    case "timeout":
    case "network":
      return { ...base, title: "Could not reach GitHub", detail: "Check your connection, then retry." };
    default:
      return { ...base, title: e.message || "Something went wrong", detail: e.hint || "" };
  }
}
