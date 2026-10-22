// Logging through session.log when it is a function, else stderr (U8: the options shape is unverified).
const MAX = 500;
const SECRET = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g;

export function createLogger(getSession) {
  function write(level, msg) {
    const text = String(msg).replace(SECRET, "[redacted]").slice(0, MAX);
    const fallback = () => console.error(`[activity-sharer] ${level}: ${text}`);
    let session;
    try { session = getSession?.(); } catch { /* no session yet */ }
    if (typeof session?.log !== "function") return fallback();
    try {
      const r = session.log(text, { level });
      if (typeof r?.catch === "function") r.catch(fallback);
    } catch {
      fallback();
    }
  }
  return {
    info: (msg) => write("info", msg),
    warn: (msg) => write("warning", msg),
    error: (msg) => write("error", msg),
  };
}
