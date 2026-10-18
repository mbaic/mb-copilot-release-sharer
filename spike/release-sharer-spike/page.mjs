// THROWAWAY P-0 spike page. Records raw platform results; never interprets them.
const $ = (id) => document.getElementById(id);
const results = {};
const err = (e) => `${e?.name ?? "Error"}: ${String(e?.message ?? e).slice(0, 200)}`;
function show(key, outId, value) {
  results[key] = value;
  $(outId).textContent = JSON.stringify(value, null, 2);
}

// U4: collect CSP violations from the very start.
const violations = [];
document.addEventListener("securitypolicyviolation", (e) =>
  violations.push({ directive: e.violatedDirective, blocked: e.blockedURI, sample: e.sample?.slice(0, 40) }));

// U4 + embedding context
async function cspReport(mode) {
  const probeEl = $("inline-style-probe");
  let ancestors = null;
  try { ancestors = Array.from(location.ancestorOrigins ?? []); } catch (e) { ancestors = err(e); }
  let topSame = null;
  try { topSame = window.top === window.self; } catch (e) { topSame = err(e); }
  show("U4", "csp-out", {
    served: mode,
    moduleScriptRan: true,
    inlineStyleAttrApplied: getComputedStyle(probeEl).backgroundColor === "rgb(1, 2, 3)",
    href: location.origin + "/<token>/",
    isTopWindow: topSame,
    ancestorOrigins: ancestors,
    referrer: document.referrer || "",
    isSecureContext: window.isSecureContext,
    violations,
  });
}

// U1/U2/U8: probe results from the server
async function loadProbe() {
  try {
    const r = await fetch("api/probe");
    const body = await r.json();
    show("probe", "probe-out", body.probe);
    await cspReport(body.cspMode);
  } catch (e) { $("probe-out").textContent = err(e); }
}

// U3: clipboard
const PLAIN = "Release Sharer spike (plain text)\nline two";
const HTML = $("rich-sample").innerHTML;
const clip = { env: {
  hasClipboardApi: Boolean(navigator.clipboard), hasWriteText: typeof navigator.clipboard?.writeText,
  hasWrite: typeof navigator.clipboard?.write, hasClipboardItem: typeof window.ClipboardItem,
} };
async function attempt(name, fn) {
  try { await fn(); clip[name] = { ok: true }; }
  catch (e) { clip[name] = { ok: false, error: err(e) }; }
  show("U3-clipboard", "clip-out", clip);
}
// Each handler calls the API directly from the click (user gesture).
$("c-text").addEventListener("click", () => attempt("writeText", () => navigator.clipboard.writeText(PLAIN)));
$("c-item").addEventListener("click", () => attempt("clipboardWriteHtmlPlain", () =>
  navigator.clipboard.write([new ClipboardItem({
    "text/html": new Blob([HTML], { type: "text/html" }),
    "text/plain": new Blob([PLAIN], { type: "text/plain" }),
  })])));
$("c-exec-text").addEventListener("click", () => attempt("execCommandText", async () => {
  const ta = document.createElement("textarea");
  ta.value = PLAIN; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("execCommand returned false");
}));
$("c-exec-rich").addEventListener("click", () => attempt("execCommandRich", async () => {
  const sel = getSelection(); const range = document.createRange();
  range.selectNodeContents($("rich-sample")); sel.removeAllRanges(); sel.addRange(range);
  const ok = document.execCommand("copy");
  if (!ok) throw new Error("execCommand returned false");
}));
show("U3-clipboard", "clip-out", clip);

// U3: splitter with pointer capture
const sp = { pointerType: null, down: 0, moveWhileCaptured: 0, up: 0, cancel: 0, lostCapture: 0, hasCaptureAfterDown: null, setCaptureError: null, lastWidth: null, keyboardMoves: 0 };
const handle = $("handle"); const split = $("split");
const setW = (w) => { const max = split.clientWidth - 80; const c = Math.max(60, Math.min(w, max)); split.style.setProperty("--list-w", c + "px"); sp.lastWidth = c; };
handle.addEventListener("pointerdown", (e) => {
  sp.down++; sp.pointerType = e.pointerType; document.body.classList.add("dragging");
  try { handle.setPointerCapture(e.pointerId); sp.hasCaptureAfterDown = handle.hasPointerCapture(e.pointerId); }
  catch (x) { sp.setCaptureError = err(x); }
  show("U3-splitter", "split-out", sp);
});
handle.addEventListener("pointermove", (e) => {
  if (!handle.hasPointerCapture?.(e.pointerId)) return;
  sp.moveWhileCaptured++;
  requestAnimationFrame(() => setW(e.clientX - split.getBoundingClientRect().left));
});
const endDrag = (kind) => (e) => {
  sp[kind]++; document.body.classList.remove("dragging");
  try { handle.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  show("U3-splitter", "split-out", sp);
};
handle.addEventListener("pointerup", endDrag("up"));
handle.addEventListener("pointercancel", endDrag("cancel"));
handle.addEventListener("lostpointercapture", () => { sp.lostCapture++; show("U3-splitter", "split-out", sp); });
handle.addEventListener("keydown", (e) => {
  const cur = $("split-left").getBoundingClientRect().width;
  if (e.key === "ArrowLeft") { setW(cur - 16); sp.keyboardMoves++; e.preventDefault(); }
  if (e.key === "ArrowRight") { setW(cur + 16); sp.keyboardMoves++; e.preventDefault(); }
  show("U3-splitter", "split-out", sp);
});
show("U3-splitter", "split-out", sp);

// U3: localStorage across reopen. The origin includes the ephemeral port, so a changed port means a fresh store.
try {
  const prev = { visits: localStorage.getItem("spike.visits"), firstSeen: localStorage.getItem("spike.firstSeen") };
  const visits = Number(prev.visits || 0) + 1;
  localStorage.setItem("spike.visits", String(visits));
  if (!prev.firstSeen) localStorage.setItem("spike.firstSeen", new Date().toISOString());
  show("U3-localStorage", "store-out", { origin: location.origin, previous: prev, visits, wrote: true });
} catch (e) { show("U3-localStorage", "store-out", { origin: location.origin, error: err(e) }); }

// U6: round trip
const rt = { phase: "idle" };
let rtStart = 0; let rtNonce = "";
$("rt").addEventListener("click", async () => {
  rtNonce = Math.random().toString(36).slice(2, 12); rtStart = Date.now();
  show("U6", "rt-out", { phase: "sending", nonce: rtNonce });
  try {
    const r = await fetch("api/roundtrip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nonce: rtNonce }) });
    Object.assign(rt, { phase: "waiting for agent", nonce: rtNonce, send: await r.json(), sendMs: Date.now() - rtStart });
  } catch (e) { Object.assign(rt, { phase: "send failed", error: err(e) }); }
  show("U6", "rt-out", rt);
});
const es = new EventSource("events");
es.addEventListener("draft", (e) => {
  const d = JSON.parse(e.data);
  Object.assign(rt, { phase: d.nonce === rtNonce ? "set_draft received (nonce matches)" : "set_draft received (nonce differs)", received: d, elapsedMs: Date.now() - rtStart });
  show("U6", "rt-out", rt);
});
es.addEventListener("error", () => { rt.sseError = (rt.sseError || 0) + 1; });
$("lp").addEventListener("click", async () => {
  try {
    const r = await fetch("api/logprobe", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    show("U8-session.log", "lp-out", { ...(await r.json()), note: "Record where each 'spike U8' message shows up (chat, timeline, logs, nowhere)." });
  } catch (e) { $("lp-out").textContent = err(e); }
});

// U7: panel width
const size = { samples: 0, min: null, max: null };
function measure() {
  const w = window.innerWidth;
  size.samples++;
  size.min = size.min === null ? w : Math.min(size.min, w);
  size.max = size.max === null ? w : Math.max(size.max, w);
  show("U7", "size-out", {
    innerWidth: w, innerHeight: window.innerHeight, outerWidth: window.outerWidth,
    visualViewportWidth: window.visualViewport?.width ?? null, devicePixelRatio: window.devicePixelRatio,
    minInnerWidthSeen: size.min, maxInnerWidthSeen: size.max, resizeSamples: size.samples,
  });
}
new ResizeObserver(measure).observe(document.body);
measure();

$("dump").addEventListener("click", () => {
  const ta = $("dump-out"); ta.hidden = false;
  ta.value = JSON.stringify(results, null, 2); ta.focus(); ta.select();
});

loadProbe();
