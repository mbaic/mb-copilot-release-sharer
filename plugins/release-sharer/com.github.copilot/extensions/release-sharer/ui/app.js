// Release Sharer UI (PLAN section 11). All dynamic text goes through textContent / text nodes.
// The only innerHTML write is the rich preview, and only from lib/formatters.mjs output.
import { buildModel } from "../lib/model.mjs";
import { format } from "../lib/formatters.mjs";
import { safeUrl } from "../lib/markdown.mjs";
import * as api from "./api.js";
import { copyRich, copyText, selectContents } from "./clipboard.js";
import { initSplitter } from "./splitter.js";
import {
  FILTERS, buildMailto, chooseSelection, clipboardText, copyLabel, describeError, filterReleases,
  mergeReleases, releaseChanged, shortDate,
} from "./logic.js";

const $ = (id) => document.getElementById(id);
const FORMATS = ["plain", "markdown", "email", "html"];
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const S = {
  repo: null, features: { rewrite: false }, view: "loading",
  releases: [], hasMore: false, page: 1, loadingMore: false,
  filter: "all", query: "", selected: null, wantedTag: null,
  format: "plain", clean: true, contributors: true, link: true, audience: "Customers",
  rewrite: null, // { tag, text, note }
  waiting: null, // tag of an outstanding rewrite request
  shown: null, // settings that produced the current editor content
  baseline: { subject: "", content: "" },
  undo: null, undoTimer: 0, copyTimer: 0, retryTimer: 0,
};

const app = $("app"), split = $("split"), list = $("list"), search = $("search");
const text = $("editor-text"), rich = $("editor-rich"), subject = $("subject");

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

const current = () => S.releases.find((r) => r.tag === S.selected) ?? null;
const repoPatch = (p) => S.repo && api.savePatch({ repos: { [S.repo]: p } });
const uiPatch = (p) => api.savePatch({ ui: p });

// ---- Views --------------------------------------------------------------------------------

function setView(v) {
  S.view = v;
  app.dataset.view = v;
  $("skeleton").hidden = v !== "loading";
  $("state-panel").hidden = v !== "panel";
  $("content").hidden = v !== "ready";
  if (v !== "ready") closePicker();
}

function showPanel(error) {
  const view = describeError(error);
  const panel = $("state-panel");
  clearTimeout(S.retryTimer);
  const kids = [h("h2", {}, view.title)];
  if (view.detail) kids.push(h("p", { class: "muted" }, view.detail));
  if (view.command) {
    const copyBtn = h("button", { class: "btn small", type: "button" }, "Copy");
    copyBtn.addEventListener("click", async () => {
      const ok = await copyText(view.command);
      copyBtn.textContent = ok ? "Copied" : "Copy failed";
      setTimeout(() => { copyBtn.textContent = "Copy"; }, 1600);
    });
    kids.push(h("div", { class: "state-row" }, h("code", {}, view.command), copyBtn));
  }
  if (view.link) {
    const href = safeUrl(view.link.href);
    if (href) kids.push(h("a", { class: "link", href, target: "_blank", rel: "noopener noreferrer" }, view.link.text));
  }
  if (view.form) {
    const input = h("input", { type: "text", class: "mono", id: "panel-repo", placeholder: "owner/repo", autocomplete: "off", spellcheck: "false", "aria-label": "Repository, owner/repo" });
    const msg = h("p", { class: "err small", role: "alert" });
    const form = h("form", {}, input, h("button", { type: "submit", class: "btn primary" }, "Load releases"));
    form.addEventListener("submit", (e) => { e.preventDefault(); submitRepo(input.value, msg); });
    kids.push(form, msg);
  }
  const actions = h("div", { class: "state-row" });
  if (view.retry) {
    const retry = h("button", { class: "btn", type: "button" }, "Retry");
    retry.addEventListener("click", () => loadFirst({ force: true }));
    const wait = view.retryAt ? view.retryAt - Date.now() : 0;
    if (wait > 0) {
      retry.disabled = true;
      S.retryTimer = setTimeout(() => { retry.disabled = false; }, wait);
    }
    actions.append(retry);
  }
  if (view.changeRepo) actions.append(h("button", { class: "btn", type: "button", onclick: openRepoEditor }, "Change repository"));
  if (actions.children.length) kids.push(actions);
  panel.replaceChildren(...kids);
  $("count").textContent = "";
  setView("panel");
  panel.querySelector("input")?.focus();
}

// ---- Top bar and repo editor ----------------------------------------------------------------

function renderTopbar() {
  $("repo-label").textContent = S.repo ?? "No repository";
  const total = S.releases.length;
  $("count").textContent = S.view === "ready" ? `${filterReleases(S.releases, { filter: S.filter, query: S.query }).length} of ${total} loaded` : "";
  document.querySelectorAll("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === S.filter)));
}

function openRepoEditor() {
  $("repo-btn").hidden = true;
  $("repo-form").hidden = false;
  $("repo-msg").textContent = "";
  const input = $("repo-input");
  input.value = S.repo ?? "";
  input.focus();
  input.select();
}

function closeRepoEditor(refocus = true) {
  $("repo-form").hidden = true;
  $("repo-btn").hidden = false;
  if (refocus) $("repo-btn").focus();
}

async function submitRepo(value, msgNode) {
  const repo = value.trim();
  if (!REPO_RE.test(repo)) { msgNode.textContent = "Use the form owner/repo."; return; }
  msgNode.textContent = "";
  const res = await api.setRepo(repo);
  if (res.error) { msgNode.textContent = res.error.message || describeError(res.error).title; return; }
  closeRepoEditor(false);
  S.releases = [];
  S.selected = S.wantedTag = null;
  S.rewrite = S.waiting = null;
  await applyServerState(await api.getState());
  await loadFirst({ force: true });
}

// ---- Release list -----------------------------------------------------------------------------

function renderList() {
  const vis = filterReleases(S.releases, { filter: S.filter, query: S.query });
  const focusTag = vis.some((r) => r.tag === S.selected) ? S.selected : vis[0]?.tag;
  list.replaceChildren(...vis.map((r) => {
    const badges = [];
    if (r.latest) badges.push(h("span", { class: "badge latest" }, "Latest"));
    if (r.prerelease) badges.push(h("span", { class: "badge pre" }, "Pre-release"));
    return h("button", { class: "row", type: "button", "data-tag": r.tag, "aria-pressed": String(r.tag === S.selected), tabindex: r.tag === focusTag ? "0" : "-1" },
      h("span", { class: "row-top" }, h("span", { class: "row-tag" }, r.tag), ...badges, h("span", { class: "row-date" }, shortDate(r.publishedAt ?? r.createdAt))),
      r.name && r.name !== r.tag ? h("span", { class: "row-name" }, r.name) : null);
  }));
  $("list-empty").hidden = vis.length > 0 || !S.releases.length;
  const more = $("load-more");
  more.hidden = !S.hasMore;
  more.disabled = S.loadingMore;
  more.textContent = S.loadingMore ? "Loading…" : "Load more";
  renderTopbar();
}

function markSelectedRow() {
  list.querySelectorAll(".row").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tag === S.selected)));
}

list.addEventListener("click", (e) => {
  const row = e.target.closest(".row");
  if (!row) return;
  selectRelease(row.dataset.tag);
  if (split.dataset.picker) { closePicker(); $("picker-btn").focus(); }
});

list.addEventListener("keydown", (e) => {
  const rows = [...list.querySelectorAll(".row")];
  const i = rows.indexOf(document.activeElement);
  if (i < 0) return;
  const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: rows.length - 1 }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  rows[Math.min(Math.max(to, 0), rows.length - 1)].focus();
});

let searchTimer = 0;
search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { S.query = search.value; renderList(); }, 150);
});
search.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { list.querySelector(".row")?.focus(); e.preventDefault(); }
});

document.addEventListener("click", (e) => {
  const f = e.target.closest("[data-filter]");
  if (!f) return;
  S.filter = f.dataset.filter;
  repoPatch({ filter: S.filter });
  renderList();
});

async function loadMore() {
  if (S.loadingMore || !S.hasMore) return;
  S.loadingMore = true;
  renderList();
  const res = await api.getReleases(S.page + 1);
  S.loadingMore = false;
  if (!res.error) {
    S.releases = mergeReleases(S.releases, res.releases ?? []);
    S.hasMore = Boolean(res.hasMore);
    S.page = res.page ?? S.page + 1;
  }
  renderList();
}
$("load-more").addEventListener("click", loadMore);

async function loadFirst({ force = false } = {}) {
  if (!S.repo) { showPanel({ code: "no_repo" }); return; }
  const refreshBtn = $("refresh");
  const hadList = S.view === "ready";
  if (!hadList) setView("loading");
  refreshBtn.classList.add("spin");
  const keepPages = hadList ? S.page : 1; // a refresh reloads every page the user had loaded
  let res = await api.getReleases(1, force);
  const releases = res.releases ? [...res.releases] : [];
  for (let page = 2; page <= keepPages && !res.error && res.hasMore; page++) {
    res = await api.getReleases(page, force);
    if (res.releases) releases.push(...res.releases);
  }
  refreshBtn.classList.remove("spin");
  if (res.error) { showPanel(res.error); return; }
  const previous = current();
  const wanted = S.selected ?? S.wantedTag;
  S.releases = mergeReleases([], releases);
  S.hasMore = Boolean(res.hasMore);
  S.page = res.page ?? 1;
  if (!S.releases.length) { showPanel({ code: "empty" }); return; }
  setView("ready");
  const pick = chooseSelection(S.releases, wanted);
  S.selected = null; // force the selection below to render
  renderList();
  const sameAsBefore = pick.tag === previous?.tag && !releaseChanged(previous, S.releases.find((r) => r.tag === pick.tag));
  if (sameAsBefore) { S.selected = pick.tag; markSelectedRow(); renderHeader(); } else selectRelease(pick.tag);
  setNotice("gone", pick.gone && hadList ? "The release you had selected is no longer available. Showing the newest." : null);
}
$("refresh").addEventListener("click", () => loadFirst({ force: true }));

// ---- Selection and generation -----------------------------------------------------------

function selectRelease(tag) {
  if (!S.releases.some((r) => r.tag === tag)) return;
  if (tag === S.selected && S.shown) return; // re-clicking the open release must not wipe edits
  const changed = tag !== S.selected;
  S.selected = tag;
  if (S.rewrite && S.rewrite.tag !== tag) S.rewrite = null;
  setNotice("gone", null);
  markSelectedRow();
  regenerate();
  if (changed) repoPatch({ lastTag: tag });
}

function isEdited() {
  if (!S.shown) return false;
  const base = S.baseline;
  if (S.shown.format === "html") return rich.innerHTML !== base.content;
  return text.value !== base.content || (S.shown.format === "email" && subject.value !== base.subject);
}

function snapshot() {
  return {
    ...S.shown, rewrite: S.rewrite,
    subject: subject.value, text: text.value,
    nodes: [...rich.childNodes].map((n) => n.cloneNode(true)), // restored by node, never via innerHTML
  };
}

/** Rebuilds the preview from the selected release and the current options. */
function regenerate({ quiet = false } = {}) {
  const rel = current();
  if (!rel) return;
  const snap = !quiet && isEdited() ? snapshot() : null;
  const model = buildModel(rel);
  const rw = S.rewrite?.tag === rel.tag ? S.rewrite.text : undefined;
  const out = format(model, { format: S.format, clean: S.clean, contributors: S.contributors, link: S.link, rewrite: rw, repoLabel: S.repo ?? "" });

  const isRich = S.format === "html";
  text.hidden = isRich;
  rich.hidden = !isRich;
  $("subject-row").hidden = S.format !== "email";
  if (isRich) {
    rich.innerHTML = out.html; // formatters output only
    S.baseline = { subject: "", content: rich.innerHTML };
  } else {
    text.value = out.body;
    subject.value = out.subject ?? "";
    S.baseline = { subject: subject.value, content: text.value };
  }
  S.shown = { tag: rel.tag, format: S.format, clean: S.clean, contributors: S.contributors, link: S.link };

  renderHeader(model);
  renderActions();
  setNotice("truncated", model.truncated ? "Release notes truncated for preview" : null, "warn");
  setNotice("emptybody", !model.sections.length && rw === undefined ? "No release notes were provided." : null, "info");
  clearUndo();
  if (snap) showUndo(snap);
  updateChars();
}

function updateChars() {
  const n = S.format === "html" ? rich.innerText.length : text.value.length;
  $("chars").textContent = `${n} chars`;
}

function renderHeader(model) {
  const rel = current();
  if (!rel) return;
  const m = model ?? buildModel(rel);
  $("d-tag").textContent = m.tag;
  const badges = [];
  if (m.latest) badges.push(h("span", { class: "badge latest" }, "Latest"));
  if (m.prerelease) badges.push(h("span", { class: "badge pre" }, "Pre-release"));
  $("d-badges").replaceChildren(...badges);
  $("d-date").textContent = m.dateLabel;
  $("d-title").textContent = m.title ?? "";
  const link = $("d-link"), href = safeUrl(rel.url);
  link.hidden = !href;
  if (href) link.setAttribute("href", href);
  $("picker-tag").textContent = m.tag;
  $("picker-name").textContent = m.title ?? "";
}

// ---- Notices, undo -----------------------------------------------------------------------------

function setNotice(key, message, kind = "warn", action) {
  const box = $("notices");
  box.querySelector(`[data-key="${key}"]`)?.remove();
  if (!message) return;
  const n = h("div", { class: `notice ${kind === "info" ? "info" : ""}`, "data-key": key }, h("span", {}, message));
  if (action) n.append(h("button", { class: "linkbtn", type: "button", onclick: action.run }, action.label));
  box.append(n);
}

function clearUndo() {
  clearTimeout(S.undoTimer);
  S.undo = null;
  setNotice("replaced", null);
}

function showUndo(snap) {
  S.undo = snap;
  setNotice("replaced", "Edits replaced ·", "warn", { label: "Undo", run: undo });
  S.undoTimer = setTimeout(clearUndo, 10_000);
}

function undo() {
  const snap = S.undo;
  if (!snap) return;
  Object.assign(S, { selected: snap.tag, format: snap.format, clean: snap.clean, contributors: snap.contributors, link: snap.link, rewrite: snap.rewrite });
  syncControls();
  markSelectedRow();
  regenerate({ quiet: true });
  if (snap.format === "html") rich.replaceChildren(...snap.nodes);
  else { text.value = snap.text; subject.value = snap.subject; }
  updateChars();
  uiPatch({ format: S.format, clean: S.clean, contributors: S.contributors, link: S.link });
  repoPatch({ lastTag: S.selected });
}

// ---- Controls -------------------------------------------------------------------------------------

function syncControls() {
  document.querySelectorAll("[data-format]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.format === S.format)));
  $("opt-clean").checked = S.clean;
  $("opt-contributors").checked = S.contributors;
  $("opt-link").checked = S.link;
  document.querySelectorAll("[data-audience]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.audience === S.audience)));
}

function setFormat(f) {
  if (f === S.format) return;
  S.format = f;
  syncControls();
  regenerate();
  uiPatch({ format: f });
}

$("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-format]");
  if (b) setFormat(b.dataset.format);
});
$("tabs").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const i = FORMATS.indexOf(S.format) + (e.key === "ArrowRight" ? 1 : -1);
  const next = FORMATS[(i + FORMATS.length) % FORMATS.length];
  e.preventDefault();
  setFormat(next);
  $("tabs").querySelector(`[data-format="${next}"]`).focus();
});

for (const key of ["clean", "contributors", "link"]) {
  $(`opt-${key}`).addEventListener("change", (e) => {
    S[key] = e.target.checked;
    regenerate();
    uiPatch({ [key]: S[key] });
  });
}

text.addEventListener("input", updateChars);
rich.addEventListener("input", updateChars);
rich.addEventListener("drop", (e) => e.preventDefault()); // dropped HTML must not enter the card
rich.addEventListener("paste", (e) => {
  e.preventDefault();
  const plain = e.clipboardData?.getData("text/plain") ?? "";
  if (!document.execCommand("insertText", false, plain)) {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(plain));
    range.collapse(false);
  }
  updateChars();
});

// ---- Copy and mail ------------------------------------------------------------------------------------

function say(message, bad = false) {
  const el = $("copy-status");
  el.classList.toggle("bad", bad);
  el.textContent = message;
  clearTimeout(S.copyTimer);
  S.copyTimer = setTimeout(() => { el.textContent = ""; }, bad ? 6000 : 1600);
}

$("copy-btn").addEventListener("click", async () => {
  const isRich = S.format === "html";
  const ok = isRich
    ? await copyRich(rich, rich.innerHTML, rich.innerText)
    : await copyText(clipboardText(S.format, { subject: subject.value, text: text.value }));
  if (ok) say("Copied");
  else {
    selectContents(isRich ? rich : text);
    say("Copy failed: select the text and press Ctrl/Cmd+C", true);
  }
});

$("mail-btn").addEventListener("click", () => {
  const { url, truncated } = buildMailto(subject.value, text.value);
  const copied = truncated ? copyText(text.value) : null;
  h("a", { href: url }).click();
  if (!truncated) { say("Opened your mail client"); return; }
  copied.then((ok) => say(ok ? "Body was long: full text copied, paste it in your mail client" : "Body was cut to fit; use Copy for the full text", !ok));
});

// ---- Actions bar and agent rewrite ---------------------------------------------------------------------

function renderActions() {
  const label = copyLabel(S.format);
  $("copy-btn").textContent = label;
  $("mail-btn").hidden = S.format !== "email";
  renderRewrite();
}

function renderRewrite() {
  const waiting = S.waiting !== null && S.waiting === S.selected;
  const rewritten = S.rewrite?.tag === S.selected;
  const btn = $("rw-btn");
  btn.hidden = !S.features.rewrite;
  btn.disabled = waiting;
  $("rw-label").textContent = waiting ? "Waiting for agent…" : "Rewrite with agent";
  $("rw-cancel").hidden = !waiting;
  $("rw-chip").hidden = !rewritten;
  $("rw-chip").title = rewritten && S.rewrite.note ? S.rewrite.note : "";
}

function openPop() {
  $("rw-pop").hidden = false;
  $("rw-btn").setAttribute("aria-expanded", "true");
  $("rw-err").textContent = "";
  $("rw-pop").querySelector("[aria-pressed='true']")?.focus();
}
function closePop(refocus = false) {
  if ($("rw-pop").hidden) return;
  $("rw-pop").hidden = true;
  $("rw-btn").setAttribute("aria-expanded", "false");
  if (refocus) $("rw-btn").focus();
}

$("rw-btn").addEventListener("click", () => ($("rw-pop").hidden ? openPop() : closePop(true)));
$("rw-pop").addEventListener("click", (e) => {
  const b = e.target.closest("[data-audience]");
  if (!b) return;
  S.audience = b.dataset.audience;
  syncControls();
  uiPatch({ audience: S.audience });
});
$("rw-go").addEventListener("click", async () => {
  const tag = S.selected;
  const go = $("rw-go");
  go.disabled = true;
  const res = await api.rewrite(tag, S.audience, S.format);
  go.disabled = false;
  if (res.error) { $("rw-err").textContent = res.error.message || "Couldn't reach the agent. Try again."; return; }
  S.waiting = tag;
  closePop(true);
  renderRewrite();
});
$("rw-cancel").addEventListener("click", () => { S.waiting = null; renderRewrite(); });
$("rw-revert").addEventListener("click", () => { S.rewrite = null; regenerate(); });

// ---- Picker (narrow / collapsed list) ------------------------------------------------------------------

function openPicker() {
  split.dataset.picker = "open";
  $("picker-btn").setAttribute("aria-expanded", "true");
  search.focus();
}
function closePicker() {
  delete split.dataset.picker;
  $("picker-btn").setAttribute("aria-expanded", "false");
}
$("picker-btn").addEventListener("click", () => (split.dataset.picker ? closePicker() : openPicker()));

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("rw-pop").hidden) { closePop(true); return; }
  if (split.dataset.picker) { closePicker(); $("picker-btn").focus(); }
});
document.addEventListener("click", (e) => {
  if (!$("rw-pop").hidden && !e.target.closest(".rw")) closePop();
  if (split.dataset.picker && !e.target.closest("#list-pane, #picker-btn")) closePicker();
});

$("repo-btn").addEventListener("click", openRepoEditor);
$("repo-form").addEventListener("submit", (e) => { e.preventDefault(); submitRepo($("repo-input").value, $("repo-msg")); });
$("repo-input").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeRepoEditor(); } });

// ---- Server events and boot ----------------------------------------------------------------------------------

async function onSelectEvent({ tag }) {
  if (typeof tag !== "string") return;
  if (S.view !== "ready") { S.wantedTag = tag; return; }
  for (let i = 0; i < 5 && !S.releases.some((r) => r.tag === tag) && S.hasMore; i++) await loadMore();
  const rel = S.releases.find((r) => r.tag === tag);
  if (!rel) return;
  if (!filterReleases([rel], { filter: S.filter, query: S.query }).length) {
    S.filter = "all";
    S.query = search.value = "";
  }
  renderList();
  selectRelease(tag);
  list.querySelector(`[data-tag="${CSS.escape(tag)}"]`)?.scrollIntoView({ block: "nearest" });
}

function onDraftEvent({ tag, text: draft, note }) {
  if (S.view !== "ready" || tag !== S.selected || typeof draft !== "string") return;
  S.rewrite = { tag, text: draft, note: typeof note === "string" ? note : "" };
  S.waiting = null;
  regenerate();
}

async function applyServerState(st) {
  if (!st || st.error) return false;
  const p = st.prefs ?? {};
  S.repo = st.repo ?? null;
  S.features = { rewrite: Boolean(st.features?.rewrite) };
  S.format = FORMATS.includes(p.format) ? p.format : "plain";
  S.clean = p.clean !== false;
  S.contributors = p.contributors !== false;
  S.link = p.link !== false;
  S.audience = p.audience === "Internal" ? "Internal" : "Customers";
  S.filter = FILTERS.includes(st.repoPrefs?.filter) ? st.repoPrefs.filter : "all";
  S.wantedTag = st.repoPrefs?.lastTag ?? S.wantedTag;
  syncControls();
  renderTopbar();
  return true;
}

async function boot() {
  const st = await api.getState();
  if (!(await applyServerState(st))) {
    showPanel(st?.error ?? { code: "network" });
    return;
  }
  const p = st.prefs ?? {};
  initSplitter({
    container: split, handle: $("handle"), chevron: $("collapse"),
    width: typeof p.listWidth === "number" ? p.listWidth : 300, collapsed: Boolean(p.listCollapsed),
    onMode: ({ narrow, collapsed }) => {
      app.dataset.compact = String(narrow || collapsed);
      if (!narrow && !collapsed) closePicker();
    },
    onSave: uiPatch,
  });
  api.connectEvents({ select: onSelectEvent, draft: onDraftEvent }, async () => {
    const again = await api.getState();
    if (again && !again.error && again.repo !== S.repo) { await applyServerState(again); await loadFirst({ force: true }); }
  });
  if (!st.repo) {
    const err = typeof st.repoError === "string" ? { code: st.repoError } : st.repoError;
    showPanel(err ?? { code: "no_repo" });
    return;
  }
  await loadFirst();
}

boot();
