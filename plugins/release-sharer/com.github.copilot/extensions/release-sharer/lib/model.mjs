// Release body -> model, plus deterministic cleaning (F-04). Line-based parser, not CommonMark.
// No DOM or Node imports, so the extension and the UI share this file.

/** @typedef {{ text:string, refs:string[], authors:string[] }} Item
 *  @typedef {{ title:string, items:Item[], paragraphs:string[] }} Section
 *  @typedef {{ tag:string, title:string|null, date:string, dateLabel:string, url:string,
 *    prerelease:boolean, latest:boolean, sections:Section[], contributors:string[],
 *    newContributors:string[], hasStructure:boolean, truncated:boolean }} Model */

const MAX_BODY = 200 * 1024; // characters; the plan's "200 KB" cap
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const HEADING = /^#{1,6}\s+(.+)$/;
const ITEM = /^(\s*)[-*+]\s+(.*)$/;
const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;
const FULL_CHANGELOG = /^\s*\*{0,2}Full Changelog\*{0,2}\s*:/i;
const WHATS_CHANGED = /^what[’'‘`]?s\s+changed:?$/i;
const NEW_CONTRIBUTORS = /^new contributors$/i;
const FIRST_CONTRIBUTION = /^@(\S+) made their first contribution/;
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;

const ATTRIBUTION = /\s+by\s+@([A-Za-z0-9-]+(?:\[bot\])?)\s+in\s+(\S+)\s*$/;
const TRAILING_PR_PARENS = /\s*\(#(\d+)\)\s*$/;
const TRAILING_PR_URL = /\s+https?:\/\/\S+\/(?:pull|issues)\/\d+\s*$/;
const TRAILING_HASH_REF = /\s+#\d+\s*$/;
const MENTION = /(^|[^A-Za-z0-9_@])@(?=[A-Za-z0-9])/g;

function stripImages(s) {
  return s.replace(IMAGE, (_, alt) => alt);
}

function normalizeRef(ref) {
  const m = /\/(?:pull|issues)\/(\d+)$/.exec(ref);
  return m ? `#${m[1]}` : ref;
}

/** Authors and PR/issue refs of one item line, read before any cleaning. */
function extractLine(line, item) {
  let rest = line;
  const a = ATTRIBUTION.exec(rest);
  if (a) {
    item.authors.push(a[1]);
    item.refs.push(normalizeRef(a[2]));
    rest = rest.slice(0, a.index);
  }
  const p = TRAILING_PR_PARENS.exec(rest);
  if (p) item.refs.push(`#${p[1]}`);
}

/**
 * Parses a release body into sections.
 * @param {string|null|undefined} body
 * @returns {{ sections: Section[], newContributors: string[], hasStructure: boolean, truncated: boolean }}
 */
export function parseBody(body) {
  let src = typeof body === "string" ? body : "";
  let truncated = false;
  if (src.length > MAX_BODY) {
    src = src.slice(0, MAX_BODY);
    const cut = src.lastIndexOf("\n");
    if (cut > 0) src = src.slice(0, cut);
    truncated = true;
  }
  src = src.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "").replace(/<!--[\s\S]*$/, "");
  const lines = src.split("\n").map((l) => l.replace(/\s+$/, ""));

  const sections = [];
  const implicit = new WeakSet(); // sections created for content before the first heading
  let cur = null;
  let item = null;
  let para = [];
  let fence = null;
  let fenceLines = [];

  const ensure = () => {
    if (!cur) {
      cur = { title: "Notes", items: [], paragraphs: [] };
      implicit.add(cur);
      sections.push(cur);
    }
    return cur;
  };
  const flushPara = () => {
    if (para.length) ensure().paragraphs.push(para.join("\n"));
    para = [];
  };
  const closesFence = (line) => {
    const t = line.trim();
    return t.length >= fence.length && t[0] === fence[0] && t === t[0].repeat(t.length);
  };

  for (const line of lines) {
    if (fence) {
      fenceLines.push(line);
      if (closesFence(line)) {
        ensure().paragraphs.push(fenceLines.join("\n"));
        fence = null;
        fenceLines = [];
      }
      continue;
    }
    const f = FENCE_OPEN.exec(line);
    if (f) {
      flushPara();
      item = null;
      fence = f[1];
      fenceLines = [line];
      continue;
    }
    if (!line.trim()) {
      flushPara();
      continue;
    }
    if (FULL_CHANGELOG.test(line)) continue;

    const h = HEADING.exec(line);
    if (h) {
      flushPara();
      item = null;
      const title = h[1].trim();
      cur = { title: WHATS_CHANGED.test(title) ? "Changes" : title, items: [], paragraphs: [] };
      sections.push(cur);
      continue;
    }

    const li = ITEM.exec(line);
    if (li) {
      flushPara();
      const text = stripImages(li[2]).trim();
      const indent = li[1].replace(/\t/g, "    ").length;
      if (indent >= 2 && item) {
        if (text) item.text += `\n  - ${text}`; // one nesting level; deeper levels are flattened into it
      } else if (text) {
        item = { text, refs: [], authors: [] };
        ensure().items.push(item);
      } else {
        item = null;
      }
      continue;
    }

    if (item && /^\s{2,}\S/.test(line)) {
      item.text += ` ${stripImages(line).trim()}`;
      continue;
    }
    item = null;
    para.push(stripImages(line));
  }
  flushPara();
  if (fence) ensure().paragraphs.push(fenceLines.join("\n")); // unterminated fence: keep what we have

  const newContributors = [];
  for (const s of sections) {
    for (const it of s.items) {
      for (const l of it.text.split("\n")) extractLine(l, it);
      if (NEW_CONTRIBUTORS.test(s.title)) {
        const m = FIRST_CONTRIBUTION.exec(it.text);
        if (m) newContributors.push(m[1]);
      }
    }
  }

  let kept = sections.filter((s) => s.items.length || s.paragraphs.length);
  const hasStructure = kept.some((s) => s.items.length > 0);
  if (!hasStructure && kept.length) {
    // Free-form body: everything becomes paragraphs of one Notes section.
    const paragraphs = [];
    for (const s of kept) {
      if (!implicit.has(s)) paragraphs.push(s.title);
      paragraphs.push(...s.paragraphs);
    }
    kept = [{ title: "Notes", items: [], paragraphs }];
  }
  return { sections: kept, newContributors, hasStructure, truncated };
}

function formatDate(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  // Hand-rolled instead of Intl en-GB: ICU abbreviates September as "Sept", and Node and browsers disagree.
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function collectContributors(sections, newContributors) {
  const seen = new Map();
  const add = (name) => {
    const key = name.toLowerCase();
    if (key === "ghost" || key.endsWith("[bot]") || seen.has(key)) return;
    seen.set(key, name);
  };
  for (const s of sections) for (const it of s.items) it.authors.forEach(add);
  newContributors.forEach(add);
  return [...seen.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, name]) => name);
}

/**
 * Builds the model from a mapped release: { tag, name, body, publishedAt, createdAt, url, prerelease, latest }.
 * @returns {Model}
 */
export function buildModel(release) {
  const r = release ?? {};
  const tag = String(r.tag ?? "");
  const name = typeof r.name === "string" ? r.name.trim() : "";
  const parsed = parseBody(r.body);
  const date = String(r.publishedAt ?? r.createdAt ?? "");
  return {
    tag,
    title: name && name.toLowerCase() !== tag.toLowerCase() ? name : null,
    date,
    dateLabel: formatDate(date),
    url: String(r.url ?? ""),
    prerelease: Boolean(r.prerelease),
    latest: Boolean(r.latest),
    sections: parsed.sections,
    contributors: collectContributors(parsed.sections, parsed.newContributors),
    newContributors: parsed.newContributors,
    hasStructure: parsed.hasStructure,
    truncated: parsed.truncated,
  };
}

/**
 * Deterministic cleaning of one line of text. With clean off the text is returned unchanged.
 * (`target` is accepted for the planned signature; cleaning is identical for every target.)
 */
export function cleanText(text, { clean = true } = {}) {
  if (!clean) return text;
  let s = text.replace(ATTRIBUTION, "");
  let prev;
  do {
    prev = s;
    s = s.replace(TRAILING_PR_PARENS, "").replace(TRAILING_PR_URL, "").replace(TRAILING_HASH_REF, "");
  } while (s !== prev);
  s = s.replace(MENTION, "$1");
  return s.replace(/ {2,}/g, " ").trim();
}

/** "Contributors: alice, bjorn" (clean on) or "Contributors: @alice, @bjorn" (clean off); "" when there are none. */
export function contributorsLine(model, { clean = true } = {}) {
  if (!model.contributors.length) return "";
  const names = model.contributors.map((n) => (clean ? n : `@${n}`));
  return `Contributors: ${names.join(", ")}`;
}
