// Clipboard strategies Call these directly from a click handler (they need the user gesture).

function execCopy() {
  try { return document.execCommand("copy"); } catch { return false; }
}

/** Copies plain text. Resolves true on success. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* fall through to the legacy path */ }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.className = "clip-shim";
  document.body.append(ta);
  ta.select();
  const ok = execCopy();
  ta.remove();
  return ok;
}

/** Selects all content of an element, so the user can press Ctrl/Cmd+C by hand. */
export function selectContents(node) {
  if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
    node.focus();
    node.select();
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(node);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Copies text/html plus a text/plain companion so links stay clickable when pasted; falls back to plain text. */
export async function copyHtml(html, text) {
  try {
    if (typeof ClipboardItem === "undefined") throw new Error("no ClipboardItem");
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([text], { type: "text/plain" }),
    })]);
    return true;
  } catch { /* fall through to plain text */ }
  return copyText(text);
}
