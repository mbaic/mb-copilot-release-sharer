// Evidence check for agent drafts (pure). It flags; it never edits the draft.
// A draft passes when every link and reference resolves to an item in the current data and every
// number is a figure the canvas shows. Number words ("three") cannot be checked and are not.
import { STALE_DAYS } from "./aggregate.mjs";

const URL_RE = /https?:\/\/[^\s<>()\[\]]+/g;
const QUAL_REF_RE = /\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\s?#(\d+)\b/g;
const BARE_REF_RE = /(?<![\w/])#(\d+)\b/g;
const NUM_RE = /(?<![\w.])\d+(?:\.\d+)?(?![\w])/g;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MON = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?";
const DATE_RES = [
  new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "g"), // Oct 14, 2026
  new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON}(?:,?\\s+(\\d{4}))?\\b`, "g"), // 14 Oct
  /\b(\d{4})-(\d{2})-(\d{2})\b/g, // 2026-10-14
];
const trimUrl = (u) => u.replace(/[.,;:!?'"*_]+$/, "").replace(/\/+$/, "");

function allItems(model) {
  const t = model.tiles;
  return [...t.merged.items, ...t.opened.items, ...t.reviews.items, ...t.issues.items, ...model.openPrs, ...model.reviewRequests];
}

export function knownUrls(model) {
  const urls = new Set();
  for (const i of allItems(model)) {
    if (i.url) urls.add(trimUrl(i.url));
    if (i.repo) urls.add(`https://github.com/${i.repo}`);
  }
  for (const r of model.repos) urls.add(`https://github.com/${r.repo}`);
  return urls;
}

/** Every number the canvas shows, as strings. */
export function shownFigures(model) {
  const s = new Set();
  const add = (n) => { if (n != null && Number.isFinite(Number(n))) s.add(String(Number(n))); };
  const t = model.tiles;
  for (const tile of Object.values(t)) {
    add(tile.count);
    add(tile.prev);
    if (tile.prev != null) add(Math.abs(tile.count - tile.prev));
    add(tile.stillOpen); add(tile.people); add(tile.closed);
    add(tile.items.length);
  }
  const ins = model.insights;
  add(ins.medianMergeDays); add(ins.prevMedianMergeDays);
  add(ins.reviewedShipped.shipped); add(ins.reviewedShipped.total);
  add(ins.topRepo?.share);
  add(ins.agentMerged?.count); add(ins.agentMerged?.total);
  for (const r of model.repos) { add(r.merged); add(r.reviews); add(r.issues); }
  add(model.repos.length); add(model.repoCountMerged);
  add(model.openPrs.length); add(model.openCount); add(model.openPrs.filter((p) => p.stale).length); add(model.reviewRequests.length);
  for (const p of model.openPrs) add(p.ageDays);
  for (const p of model.reviewRequests) add(p.ageDays);
  add(STALE_DAYS); add(model.days); add(model.limits.restrictedContributions);
  for (const b of model.chart.buckets) { add(b.merged); add(b.reviews); add(b.days); }
  for (const i of allItems(model)) {
    add(/^(\d{4})/.exec(i.date ?? "")?.[1]);
  }
  for (const d of [model.window.from, model.window.to, model.previous.from, model.previous.to]) add(/^(\d{4})/.exec(d ?? "")?.[1]);
  return s;
}

/** "month-day" keys (1-based) of every date the canvas shows. */
export function shownDates(model) {
  const keys = new Set();
  const add = (iso) => {
    const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso ?? "");
    if (m) keys.add(`${Number(m[1])}-${Number(m[2])}`);
  };
  for (const i of allItems(model)) add(i.date);
  for (const d of [model.window.from, model.window.to, model.previous.from, model.previous.to]) add(d);
  for (const b of model.chart.buckets) add(b.from);
  return keys;
}

/**
 * @returns {{ok:boolean, issues:{kind:'link'|'ref'|'number'|'date', text:string, message:string}[]}}
 */
export function checkDraft(text, model) {
  const issues = [];
  const urls = knownUrls(model);
  const items = allItems(model);
  const figures = shownFigures(model);
  let rest = String(text ?? "");

  for (const u of rest.match(URL_RE) ?? []) {
    if (!urls.has(trimUrl(u))) issues.push({ kind: "link", text: trimUrl(u), message: "This link is not one of your items." });
  }
  rest = rest.replace(URL_RE, " ");

  for (const m of rest.matchAll(QUAL_REF_RE)) {
    const ok = items.some((i) => i.repo === m[1] && String(i.number) === m[2]);
    if (!ok) issues.push({ kind: "ref", text: `${m[1]} #${m[2]}`, message: "No such item in your data." });
  }
  rest = rest.replace(QUAL_REF_RE, " ");

  for (const m of rest.matchAll(BARE_REF_RE)) {
    if (!items.some((i) => String(i.number) === m[1])) issues.push({ kind: "ref", text: `#${m[1]}`, message: "No item with this number in your data." });
  }
  rest = rest.replace(BARE_REF_RE, " ").replace(/\b1:1\b/g, " ");

  // Dates are checked as a whole: a date passes when it is one of the dates the canvas shows.
  const dates = shownDates(model);
  const monthNo = (name) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
  const dateKey = (re, m) => (re === DATE_RES[0] ? `${monthNo(m[1])}-${Number(m[2])}` : re === DATE_RES[1] ? `${monthNo(m[2])}-${Number(m[1])}` : `${Number(m[2])}-${Number(m[3])}`);
  for (const re of DATE_RES) {
    for (const m of rest.matchAll(re)) {
      if (!dates.has(dateKey(re, m))) issues.push({ kind: "date", text: m[0], message: "This date is not one the canvas shows." });
    }
    rest = rest.replace(re, " ");
  }

  const seen = new Set();
  for (const m of rest.matchAll(NUM_RE)) {
    const n = String(Number(m[0]));
    if (figures.has(n) || seen.has(n)) continue;
    seen.add(n);
    issues.push({ kind: "number", text: m[0], message: "This number is not a figure shown in the canvas." });
  }
  return { ok: issues.length === 0, issues };
}

/**
 * Splits draft text into segments; only URLs and "owner/repo #n" references that match a known item become links.
 * @returns {{text:string, href?:string}[]}
 */
export function linkify(text, model) {
  const urls = knownUrls(model);
  const byRef = new Map(allItems(model).map((i) => [`${i.repo}#${i.number}`, i.url]));
  const re = new RegExp(`${URL_RE.source}|${QUAL_REF_RE.source}`, "g");
  const out = [];
  let last = 0;
  for (const m of String(text ?? "").matchAll(re)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[0].startsWith("http")) {
      const clean = trimUrl(m[0]);
      out.push(urls.has(clean) ? { text: clean, href: clean } : { text: clean });
      if (m[0].length > clean.length) out.push({ text: m[0].slice(clean.length) });
    } else {
      const href = byRef.get(`${m[1]}#${m[2]}`);
      out.push(href ? { text: m[0], href } : { text: m[0] });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Markdown copy: known refs and URLs become links, everything else stays as written. */
export function toMarkdown(text, model) {
  return linkify(text, model).map((s) => (s.href ? `[${s.text}](${s.href})` : s.text)).join("");
}
