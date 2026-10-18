// THROWAWAY P-0 spike (PLAN section 3.3). Answers U1-U4, U6-U8. Deleted at the P0 gate.
// Rules: never log or return token values; only presence booleans and lengths.
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, mkdir, writeFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const COPILOT_HOME = process.env.COPILOT_HOME || join(homedir(), ".copilot");
const CSP_BASE = "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'";
const STATIC = {
  "": ["index.html", "text/html; charset=utf-8"],
  "page.mjs": ["page.mjs", "text/javascript; charset=utf-8"],
  "styles.css": ["styles.css", "text/css; charset=utf-8"],
};
const GH_CANDIDATES = [
  "gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh", "/home/linuxbrew/.linuxbrew/bin/gh",
  process.env.ProgramFiles && join(process.env.ProgramFiles, "GitHub CLI", "gh.exe"),
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs", "GitHub CLI", "gh.exe"),
].filter(Boolean);

const instances = new Map(); // instanceId -> { server, token, clients, cwd, probe, cspMode, url }
let session;

const log = (...a) => console.error("[spike]", ...a); // stderr: ~/.copilot/logs/extensions/ (U8 fallback)

// execFile wrapper: never rejects; returns a summary, never throws, no shell.
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    execFile(cmd, args, { timeout: 20000, maxBuffer: 20 * 1024 * 1024, windowsHide: true, ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (err.code ?? null) : 0, signal: err?.signal ?? null, ms: Date.now() - t0, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

const redactRemote = (u) => u.replace(/\/\/[^/@\s]+@/, "//***@"); // strip embedded credentials
function parseGithubRemote(u) {
  const m = /^(?:https?:\/\/(?:[^/@]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com(?::\d+)?\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(u.trim());
  return m ? { owner: m[1], repo: m[2] } : null;
}

async function runProbe(ctx) {
  const cwd = ctx.session?.workingDirectory || instances.get(ctx.instanceId)?.cwd || process.cwd();
  const out = {
    at: new Date().toISOString(),
    // U1, U8 (check 1): runtime and ctx shape
    runtime: { nodeVersion: process.version, platform: process.platform, arch: process.arch, pid: process.pid },
    ctx: {
      keys: Object.keys(ctx),
      sessionKeys: ctx.session ? Object.keys(ctx.session) : null,
      sessionProtoMethods: ctx.session ? Object.getOwnPropertyNames(Object.getPrototypeOf(ctx.session)) : null,
      instanceIdType: typeof ctx.instanceId,
      sessionIdType: typeof ctx.sessionId,
      inputKeys: ctx.input && typeof ctx.input === "object" ? Object.keys(ctx.input) : null,
      workingDirectory: ctx.session?.workingDirectory ?? null,
      processCwd: process.cwd(),
    },
    joinedSession: { keys: session ? Object.keys(session) : null, hasLog: typeof session?.log, hasSend: typeof session?.send },
    // Presence only. Never values.
    env: {
      GH_TOKEN_present: Boolean(process.env.GH_TOKEN),
      GITHUB_TOKEN_present: Boolean(process.env.GITHUB_TOKEN),
      COPILOT_HOME_present: Boolean(process.env.COPILOT_HOME),
      pathEntries: (process.env.PATH || process.env.Path || "").split(process.platform === "win32" ? ";" : ":").filter(Boolean),
    },
  };

  // Extension-scoped storage writable? (PLAN 7.4)
  const stateDir = join(COPILOT_HOME, "extensions", "release-sharer");
  try {
    await mkdir(stateDir, { recursive: true });
    const f = join(stateDir, ".spike-write-test");
    await writeFile(f, "x", { mode: 0o600 });
    const back = await readFile(f, "utf8");
    await unlink(f);
    out.stateDir = { path: stateDir, writable: back === "x" };
  } catch (e) {
    out.stateDir = { path: stateDir, writable: false, error: `${e.code ?? e.name}: ${e.message}` };
  }

  // U2 (check 2): git, gh, gh auth, releases API
  const git = { cwd };
  const inside = await run("git", ["-C", cwd, "rev-parse", "--is-inside-work-tree"]);
  git.gitFound = inside.code !== "ENOENT";
  git.insideWorkTree = inside.ok && inside.stdout.trim() === "true";
  if (git.insideWorkTree) {
    const gd = await run("git", ["-C", cwd, "rev-parse", "--git-dir", "--git-common-dir"]);
    const [gitDir, commonDir] = gd.stdout.split(/\r?\n/);
    git.gitDir = gitDir;
    git.gitCommonDir = commonDir;
    git.isLinkedWorktree = Boolean(gitDir && commonDir && gitDir !== commonDir && !gitDir.endsWith(".git"));
    const remote = await run("git", ["-C", cwd, "remote", "get-url", "origin"]);
    git.originOk = remote.ok;
    if (remote.ok) {
      const url = remote.stdout.trim();
      git.originRedacted = redactRemote(url);
      git.parsed = parseGithubRemote(url);
    } else git.originError = remote.stderr.trim().slice(0, 200);
  }
  out.git = git;

  const gh = { candidates: [] };
  let ghPath = null;
  for (const c of GH_CANDIDATES) {
    const r = await run(c, ["--version"], { timeout: 5000 });
    gh.candidates.push({ path: c, ok: r.ok, code: r.code });
    if (r.ok && !ghPath) { ghPath = c; gh.version = r.stdout.split(/\r?\n/)[0]; }
  }
  gh.resolvedPath = ghPath;
  gh.resolvedViaBarePath = ghPath === "gh";
  if (ghPath) {
    const tok = await run(ghPath, ["auth", "token"], { timeout: 10000 });
    // exit code and length only. The value is discarded.
    gh.authToken = { ok: tok.ok, code: tok.code, stdoutLength: tok.stdout.trim().length, stderr: tok.ok ? "" : tok.stderr.trim().slice(0, 200) };
    if (git.parsed) {
      const { owner, repo } = git.parsed;
      const api = await run(ghPath, ["api", "-H", "Accept: application/vnd.github+json", `repos/${owner}/${repo}/releases?per_page=1`]);
      gh.releasesApi = { ok: api.ok, ms: api.ms, code: api.code };
      if (api.ok) {
        try { const arr = JSON.parse(api.stdout); gh.releasesApi.count = arr.length; gh.releasesApi.firstTag = arr[0]?.tag_name ?? null; }
        catch { gh.releasesApi.parseError = true; }
      } else gh.releasesApi.stderr = api.stderr.trim().slice(0, 300);
    } else gh.releasesApi = { skipped: "no github.com origin parsed" };
  }
  out.gh = gh;
  return out;
}

// U8: try candidate session.log call shapes. These are probes, not asserted APIs.
async function probeLog() {
  const forms = [
    ["string only", () => session.log("spike U8: string only")],
    ["{level:'info'}", () => session.log("spike U8: level info", { level: "info" })],
    ["{level:'warning'}", () => session.log("spike U8: level warning", { level: "warning" })],
    ["{ephemeral:true}", () => session.log("spike U8: ephemeral", { ephemeral: true })],
  ];
  const results = [];
  if (typeof session?.log !== "function") return { logType: typeof session?.log, results };
  for (const [name, fn] of forms) {
    try { const r = await fn(); results.push({ form: name, threw: false, returned: r === undefined ? "undefined" : typeof r }); }
    catch (e) { results.push({ form: name, threw: true, error: `${e.name}: ${String(e.message).slice(0, 200)}` }); }
  }
  return { logType: "function", results };
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
async function readJson(req) {
  let n = 0; const chunks = [];
  for await (const c of req) { n += c.length; if (n > 65536) throw new Error("body too large"); chunks.push(c); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function startServer(inst) {
  const tokenBuf = Buffer.from(inst.token);
  const headers = () => {
    const h = { "content-security-policy": CSP_BASE, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cache-control": "no-store" };
    if (inst.cspMode === "frame-ancestors-none") {
      h["content-security-policy"] = `${CSP_BASE}; frame-ancestors 'none'`;
      h["x-frame-options"] = "DENY";
    }
    return h;
  };
  inst.server = createServer(async (req, res) => {
    try {
      const u = new URL(req.url, "http://127.0.0.1");
      const parts = u.pathname.split("/"); // ["", token, ...rest]
      const given = Buffer.from(parts[1] ?? "");
      if (given.length !== tokenBuf.length || !timingSafeEqual(given, tokenBuf)) { res.writeHead(404); return res.end(); }
      const rest = parts.slice(2).join("/");
      for (const [k, v] of Object.entries(headers())) res.setHeader(k, v);
      if (req.method === "GET" && rest in STATIC) {
        const [file, type] = STATIC[rest];
        res.setHeader("content-type", type);
        return res.end(await readFile(join(HERE, file)));
      }
      if (req.method === "GET" && rest === "api/probe") return sendJson(res, 200, { cspMode: inst.cspMode, probe: inst.probe });
      if (req.method === "GET" && rest === "events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write("event: hello\ndata: {}\n\n");
        inst.clients.add(res);
        req.on("close", () => inst.clients.delete(res));
        return;
      }
      if (req.method === "POST" && rest === "api/logprobe") return sendJson(res, 200, await probeLog());
      if (req.method === "POST" && rest === "api/roundtrip") {
        const { nonce } = await readJson(req);
        if (typeof nonce !== "string" || !/^[a-z0-9]{6,32}$/.test(nonce)) return sendJson(res, 400, { error: "bad nonce" });
        const prompt = `This is a platform test of the Release Sharer spike canvas. Call the canvas action "set_draft" on the "release-sharer-spike" canvas with text "roundtrip-ok" and nonce "${nonce}". Do not post anything in chat and do not call any other tool.`;
        try {
          const r = await session.send({ prompt, mode: "immediate", displayPrompt: "Release Sharer spike: round-trip test" });
          return sendJson(res, 200, { ok: true, returnType: r === undefined ? "undefined" : typeof r, returnKeys: r && typeof r === "object" ? Object.keys(r) : null });
        } catch (e) {
          return sendJson(res, 200, { ok: false, error: `${e.name}: ${String(e.message).slice(0, 200)}` });
        }
      }
      res.writeHead(404); res.end();
    } catch (e) {
      log("request error", e.name);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  await new Promise((resolve, reject) => {
    inst.server.once("error", reject);
    inst.server.listen(0, "127.0.0.1", resolve);
  });
  inst.url = `http://127.0.0.1:${inst.server.address().port}/${inst.token}/`;
}

async function cspModeFor(ctx) {
  const fromInput = ctx.input?.cspMode;
  if (fromInput === "baseline" || fromInput === "frame-ancestors-none") return fromInput;
  try { // fallback flag file, so the variant can be chosen however the canvas is launched
    const v = (await readFile(join(HERE, "csp-mode.txt"), "utf8")).trim();
    if (v === "frame-ancestors-none") return v;
  } catch { /* absent */ }
  return "baseline";
}

function broadcast(event, data) {
  for (const inst of instances.values())
    for (const res of inst.clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const canvas = createCanvas({
  id: "release-sharer-spike",
  displayName: "Release Sharer Spike",
  description: "Throwaway platform test canvas for Release Sharer (clipboard, CSP, gh discovery, agent round trip). Not for normal use.",
  inputSchema: {
    type: "object",
    properties: { cspMode: { type: "string", enum: ["baseline", "frame-ancestors-none"], description: "CSP variant to serve (U4). Default baseline." } },
    additionalProperties: false,
  },
  actions: [
    {
      name: "set_draft",
      description: "Platform test only. Receives the text and nonce the spike canvas asked for and shows them in the panel. Call it once with exactly the text and nonce from the prompt.",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string", description: "Text from the prompt." }, nonce: { type: "string", description: "Nonce from the prompt." } },
        required: ["text", "nonce"],
        additionalProperties: false,
      },
      handler: async (ctx) => {
        const { text, nonce } = ctx.input ?? {};
        if (typeof text !== "string" || typeof nonce !== "string") throw new Error("text and nonce are required strings");
        broadcast("draft", { text: text.slice(0, 200), nonce: nonce.slice(0, 32), at: Date.now() });
        return { ok: true };
      },
    },
    {
      name: "probe",
      description: "Platform test only. Returns the environment probe results (Node version, ctx shape, gh/git discovery) for the current working directory.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async (ctx) => runProbe(ctx),
    },
  ],
  open: async (ctx) => {
    let inst = instances.get(ctx.instanceId);
    if (!inst) {
      inst = { token: randomBytes(24).toString("base64url"), clients: new Set(), cwd: null, probe: null, cspMode: "baseline", url: "" };
      instances.set(ctx.instanceId, inst);
      inst.cspMode = await cspModeFor(ctx);
      await startServer(inst);
    }
    inst.cwd = ctx.session?.workingDirectory || process.cwd();
    inst.probe = await runProbe(ctx);
    log("open", { node: process.version, ctxKeys: Object.keys(ctx), cwd: inst.cwd, cspMode: inst.cspMode });
    return { title: "Release Sharer Spike", status: `node ${process.version}, csp ${inst.cspMode}`, url: inst.url };
  },
  onClose: async (ctx) => {
    const inst = instances.get(ctx.instanceId);
    if (!inst) return;
    for (const res of inst.clients) res.end();
    inst.server.close();
    inst.server.closeAllConnections?.();
    instances.delete(ctx.instanceId);
  },
});

session = await joinSession({ canvases: [canvas] });
