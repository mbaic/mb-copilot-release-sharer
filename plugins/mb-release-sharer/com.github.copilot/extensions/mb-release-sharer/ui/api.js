// Thin client for the instance server. URLs are relative: the page is served under /<token>/.
import { mergePatch } from "./logic.js";

const NETWORK_ERROR = { code: "network", message: "Could not reach the extension server." };

async function request(path, init) {
  try {
    const res = await fetch(path, init);
    return await res.json();
  } catch {
    return { error: NETWORK_ERROR };
  }
}

const post = (path, body) =>
  request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const getState = () => request("api/state");
export const getReleases = (page = 1, force = false) => request(`api/releases?page=${page}${force ? "&force=1" : ""}`);
export const getPrs = (tag) => request(`api/prs?tag=${encodeURIComponent(tag)}`);
export const setRepo = (repo) => post("api/repo", { repo });
export const rewrite = (tag, audience, format) => post("api/rewrite", { tag, audience, format });

// Preference patches are coalesced for a moment so a burst of changes is one request.
let pending = null;
let timer = null;
export function savePatch(patch) {
  pending = mergePatch(pending ?? {}, patch);
  clearTimeout(timer);
  timer = setTimeout(() => {
    const body = pending;
    pending = null;
    post("api/state", { patch: body });
  }, 200);
}

/** Subscribes to server-sent events; `handlers` maps event name to a callback(data). Returns the EventSource. */
export function connectEvents(handlers, onReconnect) {
  const es = new EventSource("events");
  for (const [name, fn] of Object.entries(handlers)) {
    es.addEventListener(name, (ev) => {
      try { fn(JSON.parse(ev.data)); } catch { /* ignore malformed frames */ }
    });
  }
  let dropped = false;
  es.addEventListener("error", () => { dropped = true; });
  es.addEventListener("open", () => {
    if (dropped) onReconnect?.();
    dropped = false;
  });
  return es;
}
