// Model -> plain text, Markdown, email and rich HTML. Pure and deterministic.
// No DOM or Node imports, so the extension and the UI share this file.

import { cleanText, contributorsLine } from "./model.mjs";
import { escapeHtml, safeUrl, inlineToHtml, inlineToPlain, neutralizeUnsafeLinks } from "./markdown.mjs";

const FENCE = /^\s*(`{3,}|~{3,})/;
const NEW_CONTRIBUTORS = /^new contributors$/i;
const NESTED = /^(\s*[-*+]\s+)(.*)$/;

const ROOT_STYLE = "font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2328";
const LIST_STYLE = "margin:4px 0 0 20px;padding:0";
const PRE_STYLE = "margin:8px 0 0;padding:8px;background:#f6f8fa;font-family:Consolas,'Courier New',monospace;font-size:12.5px;white-space:pre-wrap";

const isCode = (p) => FENCE.test(p);
const stripFences = (p) => p.split("\n").filter((l) => !FENCE.test(l)).join("\n");

function cleanItem(text, clean) {
  const out = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const nested = i > 0 ? NESTED.exec(lines[i]) : null;
    const body = cleanText(nested ? nested[2] : lines[i], { clean });
    if (!body) {
      if (i === 0) return ""; // an item that ends up empty is dropped, nested lines with it
      continue;
    }
    out.push((nested ? nested[1] : "") + body);
  }
  return out.join("\n");
}

function cleanParagraph(p, clean) {
  if (isCode(p)) return p; // code is never cleaned
  return p.split("\n").map((l) => cleanText(l, { clean })).filter(Boolean).join("\n");
}

/** Cleaned sections: [{ title|null, items: string[], paragraphs: [{ text, code, raw }] }]. */
function prepare(model, { clean, rewrite }) {
  if (typeof rewrite === "string" && rewrite.trim()) {
    const text = rewrite.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
    return [{ title: null, items: [], paragraphs: [{ text, code: false, raw: true }] }];
  }
  const out = [];
  for (const s of model.sections) {
    if (clean && NEW_CONTRIBUTORS.test(s.title)) continue; // their names move to the Contributors line
    const items = s.items.map((it) => cleanItem(it.text, clean)).filter(Boolean);
    const paragraphs = s.paragraphs
      .map((p) => ({ text: cleanParagraph(p, clean), code: isCode(p), raw: false }))
      .filter((p) => p.text);
    if (items.length || paragraphs.length) out.push({ title: s.title, items, paragraphs });
  }
  return out;
}

const MAX_PRS = 50;
const LINK_LABEL = "Full release notes and app for download";
const INSTALL_NOTE = "Download a new app/PTE app from the link above, extract and install in sandboxes first, then prod environment:\n[screenshot-placeholder]";

function tailParts(model, { clean, contributors, link, prs }) {
  const line = contributors ? contributorsLine(model, { clean }) : "";
  const url = link ? safeUrl(model.url) : null;
  // PR links are only emitted for http(s) URLs; anything else is dropped.
  const list = (Array.isArray(prs) ? prs : []).filter((p) => Number.isInteger(p?.number) && safeUrl(p.url)).slice(0, MAX_PRS);
  return { contributors: line, url, prs: list };
}

function tidy(s) {
  return s.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/^\n+|\n+$/g, "");
}

// --- plain text and email -------------------------------------------------------------------

function plainSections(sections, keepUrls) {
  const plain = (t) => inlineToPlain(neutralizeUnsafeLinks(t), { keepUrls });
  return sections.map((s) => {
    const blocks = s.paragraphs.map((p) => (p.raw ? p.text : p.code ? stripFences(p.text) : plain(p.text)));
    if (s.items.length) {
      blocks.push(
        s.items
          .map((text) =>
            text
              .split("\n")
              .map((l, i) => {
                const nested = i > 0 ? NESTED.exec(l) : null;
                return nested ? `  - ${plain(nested[2])}` : `- ${plain(l)}`;
              })
              .join("\n"),
          )
          .join("\n"),
      );
    }
    const body = blocks.join("\n\n");
    return s.title ? `${plain(s.title)}\n${body}` : body;
  });
}

function plainTail(model, opts) {
  const { contributors, url, prs } = tailParts(model, opts);
  const prBlock = prs.length ? `Pull requests:\n${prs.map((p) => `- #${p.number} ${safeUrl(p.url)}`).join("\n")}` : "";
  return [contributors, prBlock, url ? `${LINK_LABEL}: ${url}` : "", url ? INSTALL_NOTE : ""].filter(Boolean).join("\n\n");
}

function renderPlain(model, opts) {
  const sections = prepare(model, opts);
  const header = [model.dateLabel ? `${model.tag} (${model.dateLabel})` : model.tag, model.title].filter(Boolean).join("\n");
  return tidy([header, ...plainSections(sections, !opts.clean), plainTail(model, opts)].filter(Boolean).join("\n\n"));
}

function renderEmail(model, opts, repoLabel) {
  const sections = prepare(model, opts);
  const released = model.dateLabel ? ` (released ${model.dateLabel})` : "";
  const title = model.title ? `: ${model.title}` : "";
  const subject = `${repoLabel ? `[${repoLabel}] ` : ""}${model.tag} released${title}`.replace(/\s+/g, " ").trim();
  const body = [
    "Hi all,",
    `${model.tag} is now available${released}.`,
    ...plainSections(sections, !opts.clean),
    plainTail(model, opts),
  ]
    .filter(Boolean)
    .join("\n\n");
  return { subject, body: tidy(body) };
}

// --- Markdown -------------------------------------------------------------------------------

function renderMarkdown(model, opts) {
  const sections = prepare(model, opts);
  const md = (t) => neutralizeUnsafeLinks(t);
  const heading = `## ${model.tag}${model.title ? `: ${model.title}` : ""}`;
  const header = model.dateLabel ? `${heading}\n_Released ${model.dateLabel}_` : heading;
  const blocks = sections.map((s) => {
    const parts = s.paragraphs.map((p) => (p.raw || p.code ? p.text : md(p.text)));
    if (s.items.length) parts.push(s.items.map((t) => `- ${md(t)}`).join("\n"));
    const body = parts.join("\n\n");
    return s.title ? `### ${md(s.title)}\n${body}` : body;
  });
  const { contributors, url, prs } = tailParts(model, opts);
  const prBlock = prs.length ? `Pull requests:\n${prs.map((p) => `- [#${p.number}](${safeUrl(p.url)})`).join("\n")}` : "";
  const tail = [contributors, prBlock, url ? `[${LINK_LABEL}](${url})` : "", url ? INSTALL_NOTE : ""].filter(Boolean).join("\n\n");
  return tidy([header, ...blocks, tail].filter(Boolean).join("\n\n"));
}

// --- Rich HTML ------------------------------------------------------------------------------

function htmlItem(text) {
  const [first, ...rest] = text.split("\n");
  const children = rest.map((l) => `<li>${inlineToHtml((NESTED.exec(l) ?? [, , l])[2])}</li>`);
  const nested = children.length ? `<ul style="${LIST_STYLE}">${children.join("")}</ul>` : "";
  return `<li>${inlineToHtml(first)}${nested}</li>`;
}

function htmlParagraph(p) {
  if (p.raw) return `<p style="margin:8px 0 0">${escapeHtml(p.text).replace(/\n/g, "<br>")}</p>`;
  if (p.code) return `<pre style="${PRE_STYLE}">${escapeHtml(stripFences(p.text))}</pre>`;
  return `<p style="margin:8px 0 0">${p.text.split("\n").map(inlineToHtml).join("<br>")}</p>`;
}

function renderHtml(model, opts) {
  const sections = prepare(model, opts);
  const parts = [`<div style="font-size:18px;font-weight:600">${escapeHtml(model.tag)}${model.title ? `: ${inlineToHtml(model.title)}` : ""}</div>`];
  if (model.dateLabel) parts.push(`<div style="color:#59636e">Released ${escapeHtml(model.dateLabel)}</div>`);
  for (const s of sections) {
    if (s.title) parts.push(`<div style="font-weight:600;margin-top:12px">${inlineToHtml(s.title)}</div>`);
    parts.push(...s.paragraphs.map(htmlParagraph));
    if (s.items.length) parts.push(`<ul style="${LIST_STYLE}">${s.items.map(htmlItem).join("")}</ul>`);
  }
  const { contributors, url, prs } = tailParts(model, opts);
  if (contributors) parts.push(`<p style="margin:12px 0 0">${escapeHtml(contributors)}</p>`);
  if (prs.length) {
    const links = prs.map((p) => `<li><a href="${escapeHtml(safeUrl(p.url))}" style="color:#0969da">#${p.number}</a></li>`);
    parts.push(`<p style="margin:12px 0 0">Pull requests:</p>`, `<ul style="${LIST_STYLE}">${links.join("")}</ul>`);
  }
  if (url) parts.push(`<p style="margin:4px 0 0"><a href="${escapeHtml(url)}" style="color:#0969da">${LINK_LABEL}</a></p>`, `<p style="margin:8px 0 0">${escapeHtml(INSTALL_NOTE).replace(/\n/g, "<br>")}</p>`);
  return tidy(`<div style="${ROOT_STYLE}">\n${parts.join("\n")}\n</div>`);
}

/**
 * @param {import("./model.mjs").Model} model
 * @param {{ format: "plain"|"markdown"|"email"|"html", clean?: boolean, contributors?: boolean, link?: boolean,
 *   rewrite?: string, repoLabel?: string, prs?: { number:number, url:string }[] }} options
 * @returns {{ subject?: string, body: string, html?: string }}
 */
export function format(model, options = {}) {
  const { format: kind = "plain", clean = true, contributors = true, link = true, rewrite, repoLabel = "", prs = [] } = options;
  const opts = { clean, contributors, link, rewrite, prs };
  switch (kind) {
    case "plain": return { body: renderPlain(model, opts) };
    case "markdown": return { body: renderMarkdown(model, opts) };
    case "email": return renderEmail(model, opts, repoLabel);
    case "html": return { body: renderPlain(model, opts), html: renderHtml(model, opts) };
    default: throw new Error(`Unknown format: ${kind}`);
  }
}
