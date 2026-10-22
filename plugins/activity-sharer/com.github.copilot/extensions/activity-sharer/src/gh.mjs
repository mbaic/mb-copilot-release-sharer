// gh wrapper: one GraphQL request per range, cached per range for the life of the canvas (Refresh refetches).
// execFile with argument arrays only; no shell; no token is read (gh authenticates).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ACTIVITY_QUERY, RANGES, VIEWER_QUERY, activityVariables, ghGraphqlArgs, isValidLogin, windowsFor } from "../lib/query.mjs";
import { classifyGhError, describeGraphqlErrors, makeError } from "./errors.mjs";

const execFileP = promisify(execFile);
const GH_TIMEOUT_MS = 30_000;
const GH_MAX_BUFFER = 20 * 1024 * 1024;

/** Default exec: (file, args, {timeout, maxBuffer}) -> Promise<{stdout, stderr}>. Never uses a shell. */
export function defaultExec(file, args, opts = {}) {
  return execFileP(file, args, { ...opts, windowsHide: true, encoding: "utf8" });
}

function ghCandidates(env = process.env) {
  const list = ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh", "/home/linuxbrew/.linuxbrew/bin/gh"];
  if (env.ProgramFiles) list.push(`${env.ProgramFiles}\\GitHub CLI\\gh.exe`);
  if (env.LOCALAPPDATA) list.push(`${env.LOCALAPPDATA}\\Programs\\GitHub CLI\\gh.exe`);
  return list;
}

export function createActivityLoader({ exec = defaultExec, now = () => new Date(), candidates = ghCandidates() } = {}) {
  const cache = new Map(); // range -> result
  const inflight = new Map();
  let ghPath = null;
  let login = null;

  /** Runs gh and returns parsed JSON. A non-zero exit that still printed JSON data (partial GraphQL errors) is returned, not thrown. */
  async function gh(args) {
    let last;
    for (const file of ghPath ? [ghPath] : candidates) {
      try {
        const out = await exec(file, args, { timeout: GH_TIMEOUT_MS, maxBuffer: GH_MAX_BUFFER });
        ghPath = file;
        return JSON.parse(out.stdout);
      } catch (e) {
        if (e?.code === "ENOENT") { last = e; continue; }
        ghPath = file;
        if (typeof e?.stdout === "string" && e.stdout.trim().startsWith("{")) {
          try {
            const body = JSON.parse(e.stdout);
            if (body?.data) return body;
          } catch { /* fall through to classify */ }
        }
        throw e;
      }
    }
    throw last;
  }

  async function fetchRange(range) {
    try {
      if (!login) {
        const who = await gh(ghGraphqlArgs(VIEWER_QUERY));
        const l = who?.data?.viewer?.login;
        if (!isValidLogin(l)) throw new Error("no viewer login");
        login = l;
      }
      const windows = windowsFor(range, now());
      const body = await gh(ghGraphqlArgs(ACTIVITY_QUERY, activityVariables(login, windows)));
      if (!body?.data?.viewer) return { error: classifyGhError(JSON.stringify(body?.errors ?? body ?? "")) };
      const partial = describeGraphqlErrors(body.errors);
      return { data: body.data, windows, fetchedAt: now().toISOString(), ...(partial.length ? { partial } : {}) };
    } catch (e) {
      if (e instanceof SyntaxError || e?.message === "no viewer login") return { error: makeError("unknown") };
      return { error: classifyGhError(e) };
    }
  }

  return {
    /** @returns {Promise<{data, windows, fetchedAt, partial?}|{error}>} */
    async load({ range, force = false }) {
      if (!RANGES[range]) return { error: makeError("bad_range") };
      if (!force && cache.has(range)) return cache.get(range);
      let p = inflight.get(range);
      if (!p) {
        p = fetchRange(range).then((r) => { if (!r.error) cache.set(range, r); return r; }).finally(() => inflight.delete(range));
        inflight.set(range, p);
      }
      return p;
    },
    clear() { cache.clear(); },
  };
}
