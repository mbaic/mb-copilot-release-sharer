// Thin client for the instance server. URLs are relative: the page is served under /<token>/.
const NETWORK_ERROR = { code: "network", message: "Could not reach the extension server." };

async function request(path, init) {
  try {
    const res = await fetch(path, init);
    return await res.json();
  } catch {
    return { error: NETWORK_ERROR };
  }
}

export const getState = () => request("api/state");
export const getActivity = (range, force = false) => request(`api/activity?range=${encodeURIComponent(range)}${force ? "&force=1" : ""}`);
export const writeup = (audience, range, orgs) =>
  request("api/writeup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audience, range, orgs }) });

/** Subscribes to server-sent events; `handlers` maps event name to a callback(data). */
export function connectEvents(handlers) {
  const es = new EventSource("events");
  for (const [name, fn] of Object.entries(handlers)) {
    es.addEventListener(name, (ev) => {
      try { fn(JSON.parse(ev.data)); } catch { /* ignore malformed frames */ }
    });
  }
  return es;
}
