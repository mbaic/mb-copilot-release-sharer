// Activity Sharer UI. All dynamic text goes through textContent / text nodes; links only for known item URLs.
// Data arrives raw from the server and is aggregated here, so the org filter needs no refetch.
import { aggregate } from "../lib/aggregate.mjs";
import { summarize } from "../lib/summary.mjs";
import { checkDraft, linkify, toMarkdown } from "../lib/evidence.mjs";
import * as api from "./api.js";
import { copyText } from "./clipboard.js";
import { AUDIENCE_BUTTONS, RANGES, ageLabel, checkView, deltaView, describeError, niceTicks, safeHref, shortDate, windowLabel } from "./logic.js";

const $ = (id) => document.getElementById(id);
const SVG = "http://www.w3.org/2000/svg";

const S = {
  range: "30d", sel: null, raw: null, model: null, tile: "merged",
  draft: null, // { audience, text, model } — the model is the one the draft was requested against
  waiting: null, waitTimer: 0, writeupOff: false, copyTimer: 0,
};

/** Tiny element builder: strings become text nodes, so nothing here can inject markup. */
function h(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v == null) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  n.append(...kids.filter((k) => k != null && k !== false));
  return n;
}
const link = (href, text) => {
  const safe = safeHref(href);
  return safe ? h("a", { href: safe, target: "_blank", rel: "noopener noreferrer" }, text) : h("span", {}, text);
};
const clear = (n) => n.replaceChildren();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---- Views ---------------------------------------------------------------------------------

function showLoading() {
  $("loading").hidden = false;
  $("error").hidden = true;
  $("main").hidden = true;
}

function showError(error) {
  const view = describeError(error);
  const box = $("error");
  clear(box);
  box.append(h("h2", {}, view.title));
  if (view.detail) box.append(h("p", { class: "note" }, view.detail));
  if (view.command) {
    const b = h("button", { type: "button" }, "Copy");
    b.addEventListener("click", async () => { b.textContent = (await copyText(view.command)) ? "Copied" : "Copy failed"; setTimeout(() => { b.textContent = "Copy"; }, 1600); });
    box.append(h("div", { class: "row" }, h("code", {}, view.command), b));
  }
  if (view.link) box.append(link(view.link.href, view.link.text));
  box.append(h("div", { class: "row" }, h("button", { type: "button", class: "primary", onclick: () => load({ force: true }) }, "Retry")));
  $("loading").hidden = true;
  box.hidden = false;
  $("main").hidden = true;
  $("sub").textContent = "";
}

async function load({ force = false } = {}) {
  showLoading();
  const res = await api.getActivity(S.range, force);
  if (res.error) return showError(res.error);
  S.raw = res;
  $("loading").hidden = true;
  $("error").hidden = true;
  $("main").hidden = false;
  render();
}

function recompute() {
  S.model = aggregate(S.raw.data, S.raw.windows, { orgs: S.sel ? [...S.sel] : [] });
}

function render() {
  recompute();
  const m = S.model;
  renderOrgs();
  $("sub").textContent = `@${m.login} · ${windowLabel(m.window)} · compared with ${windowLabel(m.previous)}${m.selectedOrgs.length ? ` · only ${m.selectedOrgs.join(", ")}` : ""}`;
  renderBanners();
  const sum = summarize(m);
  $("headline").textContent = sum.headline;
  $("support").textContent = sum.support;
  renderTiles();
  renderDetail();
  renderFacts();
  renderAudiences();
  renderDraft();
  renderLoops();
  renderChart();
  renderRepos();
  renderFooter();
}

function renderOrgs() {
  const orgs = S.model.orgs;
  // Keep only still-known orgs; a selection that covers every org is the same as no filter.
  if (S.sel) {
    S.sel = new Set([...S.sel].filter((o) => orgs.includes(o)));
    if (!S.sel.size || orgs.every((o) => S.sel.has(o))) S.sel = null;
  }
  const menu = $("org-menu");
  const list = $("org-list");
  clear(list);
  menu.hidden = orgs.length < 2;
  for (const o of orgs) {
    const box = h("input", { type: "checkbox", value: o });
    box.checked = !S.sel || S.sel.has(o);
    box.addEventListener("change", () => toggleOrg(o, box));
    list.append(h("label", { class: "orgrow" }, box, h("span", {}, o)));
  }
  if (orgs.length > 1) list.append(h("button", { type: "button", class: "linkbtn", onclick: () => { S.sel = null; S.draft = null; render(); } }, "Select all"));
  $("org-summary").textContent = orgSummary(orgs);
}

function orgSummary(orgs) {
  if (!S.sel) return "All organizations";
  const names = [...S.sel].sort((a, b) => a.localeCompare(b));
  return names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

function toggleOrg(org, box) {
  const orgs = S.model.orgs;
  const next = new Set(S.sel ?? orgs);
  if (box.checked) next.add(org); else next.delete(org);
  if (!next.size) { box.checked = true; return; } // at least one stays selected
  S.sel = orgs.every((o) => next.has(o)) ? null : next;
  S.draft = null;
  const open = $("org-menu").open;
  render();
  $("org-menu").open = open;
}

function renderBanners() {
  const box = $("banners");
  clear(box);
  const m = S.model;
  for (const p of S.raw.partial ?? []) {
    box.append(h("div", { class: "banner", role: "status" }, p.kind === "sso"
      ? `Some organizations were not returned. If they use SSO, run gh auth refresh and Refresh. GitHub said: ${p.message}`
      : `GitHub reported a problem and some data may be missing: ${p.message}`));
  }
  const caps = [];
  if (m.limits.merged) caps.push("merged PRs");
  if (m.limits.open) caps.push("open PRs");
  if (m.limits.reviewRequests) caps.push("review requests");
  if (m.limits.repos || m.limits.perRepo) caps.push("per-repository lists");
  if (caps.length) box.append(h("div", { class: "banner" }, `Cap reached: showing the latest 100 for ${caps.join(", ")}. Counts are exact where GitHub gives a total.`));
}

const TILES = [
  ["merged", "PRs merged"], ["open", "Open PRs now"], ["reviews", "Reviews given"], ["issues", "Issues opened"],
];

/** Tile data; "open" is the current state (not the period), so it has no previous window. */
function tileData(key) {
  const m = S.model;
  if (key !== "open") return m.tiles[key];
  const stale = m.openPrs.filter((p) => p.stale).length;
  return { count: m.openCount, prev: null, stale, items: m.openPrs.map((p) => ({ ...p, date: null })) };
}

function subLine(key, tile) {
  if (key === "merged") return S.model.agentEnabled && S.model.insights.agentMerged ? `${S.model.insights.agentMerged.count} agent-assisted` : "";
  if (key === "open") return tile.stale ? `${tile.stale} older than 7 days` : "none older than 7 days";
  if (key === "reviews") return tile.people ? `for ${plural(tile.people, "person", "people")}` : "";
  return `${tile.closed} closed`;
}

function renderTiles() {
  const box = $("tiles");
  clear(box);
  for (const [key, label] of TILES) {
    const t = tileData(key);
    const d = deltaView(t.count, t.prev);
    const b = h("button", { class: "tile", type: "button", "data-t": key, "aria-expanded": String(S.tile === key) },
      h("span", { class: "n" }, String(t.count)), h("span", { class: "l" }, label),
      d ? h("span", { class: `d ${d.cls}` }, d.text) : h("span", { class: "d same" }, key === "open" ? "" : S.model.selectedOrgs.length && key !== "merged" ? "no comparison when filtered" : ""),
      h("span", { class: "x" }, subLine(key, t)));
    b.addEventListener("click", () => { S.tile = key; renderTiles(); renderDetail(); });
    box.append(b);
  }
}

const DETAIL_TITLES = { merged: "PRs merged", open: "Open PRs now", reviews: "Reviews given", issues: "Issues opened" };

function renderDetail() {
  const key = S.tile;
  const t = tileData(key);
  $("dt").textContent = `${DETAIL_TITLES[key]} (${t.count})`;
  const ul = $("dl");
  clear(ul);
  for (const it of t.items) {
    ul.append(h("li", {},
      h("span", { class: "t" }, link(it.url, it.title),
        it.agent ? h("span", { class: "tag agent" }, it.agent) : null,
        it.draft ? h("span", { class: "tag" }, "draft") : null,
        it.stale ? h("span", { class: "tag old" }, ageLabel(it.ageDays)) : null,
        it.author ? h("span", { class: "meta" }, ` · @${it.author}`) : null),
      h("span", { class: "meta" }, `${it.repo} #${it.number}${it.date ? ` · ${shortDate(it.date)}` : ""}${it.ageDays != null && !it.stale ? ` · ${ageLabel(it.ageDays)}` : ""}`)));
  }
  const notes = {
    merged: "Merged in this period, including PRs opened before it.",
    open: "Your open PRs right now, oldest first. This is the current state, not the period.",
    reviews: `${S.model.insights.reviewedShipped.shipped} of the ${S.model.insights.reviewedShipped.total} reviewed PRs listed are merged.`,
    issues: "Issues you opened in this period.",
  };
  const listed = t.items.length;
  const more = t.count > listed ? ` Showing ${listed} of ${t.count}.` : "";
  $("dn").textContent = (t.items.length ? notes[key] : "Nothing in this period.") + more;
}

function renderFacts() {
  const m = S.model;
  const ul = $("facts");
  clear(ul);
  const ins = m.insights;
  const med = ins.medianMergeDays;
  ul.append(h("li", {}, "Median time to merge ", h("b", {}, med == null ? "no merges" : `${med} days`),
    med != null && ins.prevMedianMergeDays != null ? h("span", { class: `d ${med < ins.prevMedianMergeDays ? "up" : "same"}` }, ` was ${ins.prevMedianMergeDays}`) : null));
  ul.append(h("li", {}, "Reviewed PRs that shipped ", h("b", {}, `${ins.reviewedShipped.shipped} of ${ins.reviewedShipped.total}`)));
  if (ins.topRepo) ul.append(h("li", {}, "Most of your work ", h("b", {}, ins.topRepo.repo), h("span", { class: "meta" }, ` (${ins.topRepo.share}%)`)));
  if (ins.agentMerged) ul.append(h("li", {}, "Agent-assisted merges ", h("b", {}, `${ins.agentMerged.count} of ${ins.agentMerged.total}`), h("span", { class: "meta" }, ` ${ins.agentMerged.names.join(" · ")}`)));
}

// ---- Write it up ---------------------------------------------------------------------------

function renderAudiences() {
  const box = $("aud");
  clear(box);
  $("write").hidden = false;
  if (S.writeupOff) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  for (const [key, label] of AUDIENCE_BUTTONS) {
    box.append(h("button", { type: "button", "data-a": key, disabled: Boolean(S.waiting), "aria-pressed": String(S.draft?.audience === key), onclick: () => requestWriteup(key) }, label));
  }
}

async function requestWriteup(audience) {
  S.waiting = audience;
  S.draft = null;
  $("write-err").hidden = true;
  renderAudiences();
  renderDraft();
  const snapshot = S.model;
  const res = await api.writeup(audience, S.range, S.sel ? [...S.sel] : []);
  if (res.error) {
    S.waiting = null;
    S.writeupOff = true;
    renderAudiences();
    renderDraft();
    $("write-err").hidden = false;
    $("write-err").textContent = `${res.error.message ?? "The agent could not be reached."} Write-up is hidden for this canvas. You can still ask the agent in chat: it has the get_activity action.`;
    return;
  }
  S.pendingModel = snapshot;
  clearTimeout(S.waitTimer);
  S.waitTimer = setTimeout(() => { if (S.waiting) { S.waiting = null; renderAudiences(); renderDraft(); } }, 180_000);
}

function onDraft({ audience, text }) {
  clearTimeout(S.waitTimer);
  S.waiting = null;
  // Check against the data the draft was requested for; fall back to what is on screen.
  S.draft = { audience, text, model: S.pendingModel ?? S.model };
  S.pendingModel = null;
  renderAudiences();
  renderDraft();
}

function renderDraft() {
  const d = $("draft");
  const check = $("check");
  const row = $("copyrow");
  clear(d);
  $("copied").textContent = "";
  if (S.waiting) {
    d.className = "draft empty";
    d.textContent = "Asked the agent. The draft appears here when it answers.";
    check.hidden = true;
    row.hidden = true;
    return;
  }
  if (!S.draft) {
    d.className = "draft empty";
    d.textContent = "Pick an audience. The draft appears here, and the agent session shows the request.";
    check.hidden = true;
    row.hidden = true;
    return;
  }
  d.className = "draft";
  for (const seg of linkify(S.draft.text, S.draft.model)) d.append(seg.href ? link(seg.href, seg.text) : document.createTextNode(seg.text));
  const view = checkView(checkDraft(S.draft.text, S.draft.model));
  clear(check);
  check.className = `check ${view.cls}`;
  check.append(h("div", {}, view.title));
  if (view.items.length) check.append(h("ul", {}, ...view.items.map((i) => h("li", {}, i))));
  check.hidden = false;
  row.hidden = false;
}

async function copy(kind) {
  if (!S.draft) return;
  const text = kind === "md" ? toMarkdown(S.draft.text, S.draft.model) : S.draft.text;
  const ok = await copyText(text);
  $("copied").textContent = ok ? (kind === "md" ? "Markdown copied" : "Text copied") : "Copy failed: select the draft and press Ctrl/Cmd+C";
  clearTimeout(S.copyTimer);
  S.copyTimer = setTimeout(() => { $("copied").textContent = ""; }, 2500);
}

// ---- Lists, chart, table -------------------------------------------------------------------

function renderLoops() {
  const m = S.model;
  $("open-note").textContent = plural(m.openPrs.length, "open PR");
  const ol = $("open-list");
  clear(ol);
  if (!m.openPrs.length) ol.append(h("li", {}, h("span", { class: "meta" }, "No open PRs.")));
  for (const p of m.openPrs) {
    ol.append(h("li", {},
      h("span", { class: "t" }, link(p.url, p.title), p.draft ? h("span", { class: "tag" }, "draft") : null,
        p.stale ? h("span", { class: "tag old" }, ageLabel(p.ageDays)) : null, p.agent ? h("span", { class: "tag agent" }, p.agent) : null),
      h("span", { class: "meta" }, `${p.repo} #${p.number}${p.stale ? "" : ` · ${ageLabel(p.ageDays)}`}`)));
  }
  $("req-note").textContent = plural(m.reviewRequests.length, "request");
  const rl = $("req-list");
  clear(rl);
  if (!m.reviewRequests.length) rl.append(h("li", {}, h("span", { class: "meta" }, "Nothing waiting on you.")));
  for (const p of m.reviewRequests) {
    rl.append(h("li", {}, h("span", { class: "t" }, link(p.url, p.title)),
      h("span", { class: "meta" }, `${p.repo} #${p.number}${p.author ? ` · @${p.author}` : ""} · ${ageLabel(p.ageDays)}`)));
  }
}

function renderChart() {
  const m = S.model;
  const { unit, buckets } = m.chart;
  $("chart-title").textContent = unit === "day" ? "Per day" : unit === "week" ? "Per week" : "Per 30 days";
  const svg = $("chart");
  clear(svg);
  const el = (name, attrs, text) => {
    const n = document.createElementNS(SVG, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    if (text != null) n.textContent = text;
    return n;
  };
  const maxVal = Math.max(1, ...buckets.flatMap((b) => [b.merged, b.reviews]));
  const ticks = niceTicks(maxVal);
  const max = ticks[3];
  const W = 600, top = 10, base = 140, left = 28;
  const gw = (W - left) / buckets.length;
  const bw = Math.max(3, Math.min(22, gw / 2 - 3));
  for (const v of ticks) {
    const y = base - (v / max) * (base - top);
    svg.append(el("line", { x1: left, x2: W, y1: y, y2: y, stroke: "var(--bd)", "stroke-width": 1 }),
      el("text", { x: left - 8, y: y + 4, "text-anchor": "end", "font-size": 11, fill: "var(--mut)" }, v));
  }
  const every = buckets.length > 10 ? 2 : 1;
  buckets.forEach((b, i) => {
    const cx = left + gw * i + gw / 2;
    const label = shortDate(b.from);
    const partial = unit !== "day" && b.days < (unit === "week" ? 7 : 30);
    for (const [val, color, dx, what] of [[b.merged, "var(--s1)", -bw - 1, "PRs merged"], [b.reviews, "var(--s2)", 1, "Reviews given"]]) {
      const hgt = (val / max) * (base - top);
      const r = el("rect", { x: cx + dx, y: base - hgt, width: bw, height: hgt, rx: 2, fill: color });
      r.append(el("title", {}, `${label}${partial ? ` (${b.days} days)` : ""}: ${val} ${what}`));
      svg.append(r);
    }
    if (i % every === 0) svg.append(el("text", { x: cx, y: base + 18, "text-anchor": "middle", "font-size": 11, fill: "var(--mut)" }, label));
  });
}

function renderRepos() {
  const body = $("repos");
  clear(body);
  if (!S.model.repos.length) body.append(h("tr", {}, h("td", { colspan: 4, class: "meta" }, "No repositories in this period.")));
  for (const r of S.model.repos) {
    body.append(h("tr", {}, h("td", {}, link(`https://github.com/${r.repo}`, r.repo)),
      h("td", { class: "n" }, String(r.merged)), h("td", { class: "n" }, String(r.reviews)), h("td", { class: "n" }, String(r.issues))));
  }
}

function renderFooter() {
  const m = S.model;
  const parts = [];
  if (m.limits.restrictedContributions) parts.push(`${plural(m.limits.restrictedContributions, "private contribution")} counted by GitHub but not listed.`);
  if (m.agentEnabled) parts.push('"Agent-assisted" means the PR was opened by an agent on your behalf or has an agent branch prefix.');
  parts.push("Counts show activity, not effort or value.");
  $("footer").textContent = parts.join(" ");
}

// ---- Boot ----------------------------------------------------------------------------------

function boot() {
  const range = $("range");
  range.append(...RANGES.map(([v, l]) => h("option", { value: v }, l)));
  range.value = S.range;
  range.addEventListener("change", () => { S.range = range.value; S.draft = null; load(); });
  // The org menu closes on an outside click or Escape.
  document.addEventListener("click", (e) => { if (!$("org-menu").contains(e.target)) $("org-menu").open = false; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("org-menu").open = false; });
  $("refresh").addEventListener("click", () => load({ force: true }));
  $("copy-text").addEventListener("click", () => copy("text"));
  $("copy-md").addEventListener("click", () => copy("md"));
  api.connectEvents({ draft: onDraft });
  load();
}

boot();
