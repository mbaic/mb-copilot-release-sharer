// Per-instance loopback HTTP server: serves the UI and a small JSON/SSE API behind a random path token.
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const UI_FILES = new Set(["styles.css", "app.js", "api.js", "clipboard.js", "logic.js"]);
const LIB_FILES = new Set(["aggregate.mjs", "agent.mjs", "summary.mjs", "evidence.mjs"]);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
};
const MAX_BODY = 16 * 1024;
const PING_MS = 25_000;

/**
 * @param {object} deps
 * @param {string} deps.extDir
 * @param {string} deps.version
 * @param {(q:{range:string, force:boolean}) => Promise<object>} deps.loadActivity
 * @param {(r:{audience:string, range:string, orgs:string[]}) => Promise<void>} deps.writeup
 * @param {{error(m:string):void}} [deps.log]
 * @param {number} [deps.pingMs]
 */
export async function startInstanceServer(deps) {
  const token = randomBytes(24).toString("base64url");
  const tokenBuf = Buffer.from(token);
  const streams = new Set();
  let port = 0;

  const csp = [
    "default-src 'none'", "script-src 'self'", "style-src 'self'", "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:", "connect-src 'self'", "base-uri 'none'", "form-action 'none'",
  ].join("; ");
  const baseHeaders = {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
  };

  const send = (res, status, body, type = "application/json; charset=utf-8") => {
    res.writeHead(status, { ...baseHeaders, "Content-Type": type });
    res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const bare = (res, status = 404) => { res.writeHead(status, baseHeaders); res.end(); };

  const readJson = (req) => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error("too large"), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(Object.assign(new Error("bad json"), { status: 400 })); }
    });
    req.on("error", reject);
  });

  const serveFile = async (res, file, name) => {
    try { send(res, 200, await readFile(file), TYPES[path.extname(name)] ?? "application/octet-stream"); }
    catch { bare(res); }
  };

  async function route(req, res, sub, url) {
    if (req.method === "GET") {
      if (sub === "/") return serveFile(res, path.join(deps.extDir, "ui", "index.html"), "index.html");
      if (sub.startsWith("/ui/") && UI_FILES.has(sub.slice(4))) return serveFile(res, path.join(deps.extDir, "ui", sub.slice(4)), sub);
      if (sub.startsWith("/lib/") && LIB_FILES.has(sub.slice(5))) return serveFile(res, path.join(deps.extDir, "lib", sub.slice(5)), sub);
      if (sub === "/api/state") return send(res, 200, { version: deps.version, features: { writeup: true } });
      if (sub === "/api/activity") {
        const range = url.searchParams.get("range") ?? "30d";
        return send(res, 200, await deps.loadActivity({ range, force: url.searchParams.get("force") === "1" }));
      }
      if (sub === "/events") {
        res.writeHead(200, { ...baseHeaders, "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive" });
        res.write("retry: 2000\n\n");
        streams.add(res);
        res.on("close", () => streams.delete(res));
        return;
      }
      return send(res, 404, { error: { code: "not_found" } });
    }
    if (req.method === "POST") {
      const origin = req.headers.origin;
      if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return send(res, 403, { error: { code: "forbidden_origin" } });
      if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) return send(res, 415, { error: { code: "unsupported_media_type" } });
      let body;
      try { body = await readJson(req); }
      catch (e) { return send(res, e.status ?? 400, { error: { code: e.status === 413 ? "too_large" : "bad_request" } }); }
      if (sub === "/api/writeup") {
        const orgs = body.orgs ?? [];
        const okOrgs = Array.isArray(orgs) && orgs.length <= 50 && orgs.every((o) => typeof o === "string" && /^[A-Za-z0-9-]{1,39}$/.test(o));
        if (typeof body.audience !== "string" || typeof body.range !== "string" || !okOrgs) return send(res, 400, { error: { code: "bad_request" } });
        try { await deps.writeup({ audience: body.audience, range: body.range, orgs }); }
        catch (e) {
          deps.log?.error(`write-up failed: ${e?.message ?? e}`);
          return send(res, 200, { error: { code: "agent_unreachable", message: "Couldn't reach the agent. Try again." } });
        }
        return send(res, 200, { ok: true });
      }
    }
    return send(res, 404, { error: { code: "not_found" } });
  }

  const server = createServer((req, res) => {
    const host = req.headers.host;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return bare(res, 421);
    let url;
    try { url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`); } catch { return bare(res); }
    // First path segment must be the token; everything else is a bare 404.
    const m = /^\/([A-Za-z0-9_-]+)(\/.*)?$/.exec(url.pathname);
    const given = Buffer.from(m?.[1] ?? "");
    if (!m || given.length !== tokenBuf.length || !timingSafeEqual(given, tokenBuf)) return bare(res);
    route(req, res, m[2] ?? "/", url).catch((e) => {
      deps.log?.error(`server error: ${e?.message ?? e}`);
      if (!res.headersSent) send(res, 500, { error: { code: "internal" } });
      else res.end();
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  port = server.address().port;

  const ping = setInterval(() => broadcast("ping", {}), deps.pingMs ?? PING_MS);
  ping.unref?.();

  function broadcast(event, data) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const s of streams) s.write(frame);
  }

  return {
    url: `http://127.0.0.1:${port}/${token}/`,
    port,
    token,
    broadcast,
    stop() {
      clearInterval(ping);
      for (const s of streams) s.end();
      streams.clear();
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
  };
}
