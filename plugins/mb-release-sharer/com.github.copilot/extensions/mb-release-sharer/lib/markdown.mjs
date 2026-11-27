// Tiny inline-markdown helpers. Release notes are untrusted: escape first, then add markup.
// No DOM or Node imports, so the extension and the UI share this file.

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const LINK = /\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g; // one level of parentheses allowed inside the URL
const TOKEN = /\u0000(\d+)\u0000/g;
const CODE_STYLE = "font-family:Consolas,'Courier New',monospace;background:#f6f8fa;padding:1px 4px;border-radius:4px";

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Returns the URL (control and whitespace characters removed) if it is http(s), otherwise null. */
export function safeUrl(u) {
  if (typeof u !== "string") return null;
  const s = u.replace(/[\x00-\x20\x7f-\x9f\p{Cf}\p{Z}]/gu, ""); // control, format (zero-width, BOM) and separator characters
  return /^https?:\/\/[^/?#]/i.test(s) ? s : null;
}

// Deliberately looser than LINK: a downstream Markdown renderer may accept destinations we would not render.
const ANY_LINK = /\[([^\]]+)\]\(((?:[^()]|\([^()]*\))*)\)/g;
const AUTOLINK = /<([a-z][a-z0-9+.-]*:[^<>\s]*)>/gi;
const LINK_DEFINITION = /^ {0,3}\[[^\]]+\]:[ \t]*(\S+).*$/gm;

/**
 * Makes Markdown safe to hand on: links, autolinks and reference definitions whose URL is not http(s)
 * lose their target and keep their text. Safe links are left untouched.
 */
export function neutralizeUnsafeLinks(text) {
  return String(text)
    .replace(ANY_LINK, (m, label, url) => (safeUrl(url.trim().split(/\s+"/)[0]) ? m : label))
    .replace(AUTOLINK, (m, url) => (safeUrl(url) ? m : url))
    .replace(LINK_DEFINITION, (m, url) => (safeUrl(url) ? m : ""));
}

function stasher() {
  const store = [];
  const stash = (value) => `\u0000${store.push(value) - 1}\u0000`;
  const restore = (s) => s.replace(TOKEN, (_, i) => restore(store[Number(i)]));
  return { stash, restore };
}

function emphasisHtml(s) {
  return s
    .replace(/\*\*(\S(?:.*?\S)?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(\S(?:[^*]*?\S)?)\*/g, "<em>$1</em>")
    .replace(/(^|\W)_(\S(?:[^_]*?\S)?)_(?!\w)/g, "$1<em>$2</em>");
}

function emphasisPlain(s) {
  return s
    .replace(/\*\*(\S(?:.*?\S)?)\*\*/g, "$1")
    .replace(/\*(\S(?:[^*]*?\S)?)\*/g, "$1")
    .replace(/(^|\W)_(\S(?:[^_]*?\S)?)_(?!\w)/g, "$1$2");
}

/** Inline markdown to HTML. Escapes everything first; links only survive when safeUrl accepts them. */
export function inlineToHtml(text) {
  const { stash, restore } = stasher();
  let s = escapeHtml(String(text).replace(/\u0000/g, ""));
  s = s.replace(/`([^`]+)`/g, (_, code) => stash(`<code style="${CODE_STYLE}">${code}</code>`));
  s = s.replace(LINK, (_, label, url) => {
    const href = safeUrl(url);
    const inner = emphasisHtml(label);
    return stash(href ? `<a href="${href}" style="color:#0969da" target="_blank" rel="noopener noreferrer">${inner}</a>` : inner);
  });
  return restore(emphasisHtml(s));
}

/** Inline markdown to plain text. `[t](u)` becomes `t`, or `t (u)` with keepUrls and a safe URL. */
export function inlineToPlain(text, { keepUrls = false } = {}) {
  const { stash, restore } = stasher();
  let s = String(text).replace(/\u0000/g, "");
  s = s.replace(/`([^`]+)`/g, (_, code) => stash(code));
  s = s.replace(LINK, (_, label, url) => {
    const safe = safeUrl(url);
    const inner = emphasisPlain(label);
    return stash(keepUrls && safe && safe !== label ? `${inner} (${safe})` : inner);
  });
  return restore(emphasisPlain(s));
}

const BARE_URL = /https?:\/\/[^\s<>"']+/g;
const LINK_STYLE = 'style="color:#0969da"';

/** Escapes plain text and turns bare http(s) URLs into links (trailing punctuation stays outside). */
function linkifyPlain(line) {
  let out = "";
  let last = 0;
  for (const m of line.matchAll(BARE_URL)) {
    const url = m[0].replace(/[.,;:!?)\]]+$/, "");
    const href = safeUrl(url);
    out += escapeHtml(line.slice(last, m.index));
    out += href ? `<a href="${escapeHtml(href)}" ${LINK_STYLE}>${escapeHtml(url)}</a>` : escapeHtml(url);
    last = m.index + url.length;
  }
  return out + escapeHtml(line.slice(last));
}

/**
 * HTML for pasting into mail or chat, built from the (possibly edited) preview text so links are clickable.
 * `markdown` mode renders headings, "- " bullets and [text](url); plain mode keeps lines and linkifies bare URLs.
 * Everything is escaped; only http(s) links survive.
 */
export function textToHtml(text, { markdown = false } = {}) {
  const inline = markdown ? inlineToHtml : linkifyPlain;
  const out = [];
  let list = [];
  let para = [];
  const flushList = () => { if (list.length) out.push(`<ul style="margin:4px 0 0 20px;padding:0">${list.join("")}</ul>`); list = []; };
  const flushPara = () => { if (para.length) out.push(`<p style="margin:8px 0 0">${para.join("<br>")}</p>`); para = []; };
  for (const line of String(text).replace(/\r\n?/g, "\n").split("\n")) {
    const heading = markdown ? /^#{1,6}\s+(.*)$/.exec(line) : null;
    const item = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (!line.trim()) { flushList(); flushPara(); }
    else if (heading) { flushList(); flushPara(); out.push(`<p style="margin:12px 0 0;font-weight:600">${inline(heading[1])}</p>`); }
    else if (item) { flushPara(); list.push(`<li>${inline(item[1])}</li>`); }
    else { flushList(); para.push(inline(line)); }
  }
  flushList();
  flushPara();
  return `<div style="font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.5">${out.join("")}</div>`;
}
