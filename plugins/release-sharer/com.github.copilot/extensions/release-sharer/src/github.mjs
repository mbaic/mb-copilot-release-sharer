// GitHub access through the gh CLI and git (PLAN 7.3). No tokens are read, stored or logged: gh owns authentication.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/** Default exec: (file, args, {timeout, maxBuffer}) -> Promise<{stdout, stderr}>. Never uses a shell. */
export function defaultExec(file, args, opts = {}) {
  return execFileP(file, args, { ...opts, windowsHide: true, encoding: "utf8" });
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GIT_TIMEOUT_MS = 5000;
const GH_TIMEOUT_MS = 20000;
const GH_MAX_BUFFER = 20 * 1024 * 1024;

export function isValidRepo(str) {
  return typeof str === "string" && REPO_RE.test(str);
}

/** Parses a git remote URL. Credentials and ports are dropped; the host is lowercased. */
export function parseRemote(url) {
  if (typeof url !== "string") return null;
  const s = url.trim();
  let host;
  let path;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    let u;
    try { u = new URL(s); } catch { return null; }
    host = u.hostname;
    path = u.pathname;
  } else {
    const m = /^(?:[^@/\s]+@)?([^:/\s]{2,}):(\S+)$/.exec(s); // git@host:owner/repo
    if (!m) return null;
    host = m[1];
    path = m[2];
  }
  const parts = path.split("/").filter(Boolean);
  if (!host || parts.length !== 2) return null;
  const repo = parts[1].replace(/\.git$/i, "");
  if (!parts[0] || !repo) return null;
  return { host: host.toLowerCase(), owner: parts[0], repo };
}

const TEXT = {
  gh_missing: ["GitHub CLI (gh) was not found.", "Install it from https://cli.github.com and run `gh auth login`."],
  gh_not_authenticated: ["GitHub CLI is not signed in.", "Run `gh auth login` in a terminal, then Refresh."],
  repo_not_found: ["Repository or releases not found.", "Check the owner/repo name and that your account can see the repository."],
  forbidden: ["GitHub denied access.", "If the organization uses SSO, authorize gh for it (`gh auth refresh`), then Refresh."],
  rate_limited: ["GitHub rate limit reached.", "Wait a while and Refresh. Signing in with `gh auth login` raises the limit."],
  timeout: ["GitHub did not answer in time.", "Check your connection and Refresh."],
  network: ["Could not reach GitHub.", "Check your network or proxy settings and Refresh."],
  not_a_repo: ["This folder is not a Git repository with a GitHub remote.", "Enter owner/repo manually."],
  invalid_repo: ["That is not a valid owner/repo name.", "Use the form owner/repo, for example acme/bc-app."],
  unsupported_host: ["Only github.com repositories are supported.", "Enter a github.com owner/repo manually."],
  unknown: ["Something went wrong talking to GitHub.", "Try Refresh. If it keeps failing, run `gh auth status` in a terminal."],
};

/** Builds a normalized `{code, message, hint}` error for a code. */
export function makeError(code, extra) {
  const [message, hint] = TEXT[code] ?? TEXT.unknown;
  return { code, message, hint, ...extra };
}

function parseResetAt(text) {
  const m = /x-ratelimit-reset:\s*(\d{9,11})/i.exec(text);
  if (!m) return undefined;
  const d = new Date(Number(m[1]) * 1000);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Classifies a failed gh call from an exec error (or a plain stderr string). */
export function classifyGhError(e) {
  const isStr = typeof e === "string";
  const text = isStr ? e : `${e?.stderr ?? ""}\n${e?.message ?? ""}`;
  if (!isStr && e?.code === "ENOENT") return makeError("gh_missing");
  if (!isStr && (e?.code === "ETIMEDOUT" || e?.killed)) return makeError("timeout");
  if (/rate limit|abuse detection/i.test(text)) return makeError("rate_limited", { resetAt: parseResetAt(text) });
  if (/gh auth login|not logged in|HTTP 401|bad credentials/i.test(text)) return makeError("gh_not_authenticated");
  if (/HTTP 403|SAML|SSO|forbidden/i.test(text)) return makeError("forbidden");
  if (/HTTP 404|not found/i.test(text)) return makeError("repo_not_found");
  if (/no such host|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|dial tcp|could not resolve|network is unreachable|i\/o timeout|tls handshake|proxyconnect/i.test(text)) return makeError("network");
  return makeError("unknown");
}

/** Detects the GitHub repo of a working directory from its git remote. */
export async function detectRepo(cwd, { exec = defaultExec } = {}) {
  if (typeof cwd !== "string" || !cwd) return { error: makeError("not_a_repo") };
  const git = async (...args) => (await exec("git", ["-C", cwd, ...args], { timeout: GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024 })).stdout.trim();
  let url = "";
  try {
    url = await git("remote", "get-url", "origin");
  } catch {
    try {
      const first = (await git("remote")).split(/\r?\n/)[0]?.trim();
      if (first && !first.startsWith("-")) url = await git("remote", "get-url", first);
    } catch { /* not a repo, or no remote */ }
  }
  const parsed = parseRemote(url);
  if (!parsed) return { error: makeError("not_a_repo") };
  if (parsed.host !== "github.com") return { error: makeError("unsupported_host") };
  const full = `${parsed.owner}/${parsed.repo}`;
  if (!isValidRepo(full)) return { error: makeError("invalid_repo") };
  return { host: parsed.host, owner: parsed.owner, repo: parsed.repo, full };
}

function ghCandidates(env = process.env) {
  const list = ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh", "/home/linuxbrew/.linuxbrew/bin/gh"];
  if (env.ProgramFiles) list.push(`${env.ProgramFiles}\\GitHub CLI\\gh.exe`);
  if (env.LOCALAPPDATA) list.push(`${env.LOCALAPPDATA}\\Programs\\GitHub CLI\\gh.exe`);
  return list;
}

const time = (r) => Date.parse(r.publishedAt ?? r.createdAt ?? "") || 0;

function mapRelease(r) {
  return {
    id: r.id,
    tag: r.tag_name,
    name: r.name ?? null,
    body: r.body ?? "",
    draft: Boolean(r.draft),
    prerelease: Boolean(r.prerelease),
    publishedAt: r.published_at ?? null,
    createdAt: r.created_at ?? null,
    url: r.html_url ?? "",
    author: r.author?.login ?? null,
    latest: false,
  };
}

class BadResponse extends Error {}

/** Releases loader with a short in-memory cache and shared in-flight requests. */
export function createReleaseLoader({ exec = defaultExec, now = Date.now, ttlMs = 60000 } = {}) {
  const cache = new Map(); // key -> { at, value }
  const inflight = new Map();
  const byTag = new Map(); // "owner/repo" -> Map(tag -> release), for actions
  let ghPath = null;

  async function gh(args) {
    let last;
    for (const file of ghPath ? [ghPath] : ghCandidates()) {
      try {
        const out = await exec(file, args, { timeout: GH_TIMEOUT_MS, maxBuffer: GH_MAX_BUFFER });
        ghPath = file;
        return out.stdout;
      } catch (e) {
        if (e?.code !== "ENOENT") { ghPath = file; throw e; }
        last = e;
      }
    }
    throw last;
  }

  const api = (path) => gh(["api", "-H", "Accept: application/vnd.github+json", path]);

  async function fetchPage({ owner, repo, page, perPage }) {
    const base = `repos/${owner}/${repo}/releases`;
    const latest = () => api(`${base}/latest`).then((s) => JSON.parse(s), () => null);
    // Until gh is located, list first so the two calls do not probe candidate paths twice.
    const early = page === 1 && ghPath ? latest() : null;
    let items;
    try {
      items = JSON.parse(await api(`${base}?per_page=${perPage}&page=${page}`));
      if (!Array.isArray(items)) throw new BadResponse();
    } catch (e) {
      await early;
      return { error: e instanceof SyntaxError || e instanceof BadResponse ? makeError("unknown") : classifyGhError(e) };
    }
    const latestRaw = page === 1 ? await (early ?? latest()) : null;
    const seen = new Set();
    const releases = items
      .filter((r) => r && typeof r.tag_name === "string" && !seen.has(r.id) && seen.add(r.id))
      .map(mapRelease)
      .filter((r) => !r.draft)
      .sort((a, b) => time(b) - time(a));
    if (page === 1) {
      const mark = latestRaw ? releases.find((r) => r.id === latestRaw.id) : releases.find((r) => !r.prerelease);
      if (mark) mark.latest = true;
    }
    const k = `${owner}/${repo}`.toLowerCase();
    const tags = byTag.get(k) ?? new Map();
    for (const r of releases) tags.set(r.tag, r);
    byTag.set(k, tags);
    return { releases, hasMore: items.length === perPage, page };
  }

  return {
    async load({ owner, repo, page = 1, perPage = 30, force = false } = {}) {
      if (typeof owner !== "string" || typeof repo !== "string" || !isValidRepo(`${owner}/${repo}`)) return { error: makeError("invalid_repo") };
      if (!Number.isInteger(page) || page < 1 || !Number.isInteger(perPage) || perPage < 1 || perPage > 100) {
        return { error: makeError("unknown") };
      }
      const key = `${owner}/${repo}`.toLowerCase() + `#${page}#${perPage}`;
      const hit = cache.get(key);
      if (!force && hit && now() - hit.at < ttlMs) return hit.value;
      let p = inflight.get(key);
      if (!p) {
        p = fetchPage({ owner, repo, page, perPage })
          .then((value) => {
            if (!value.error) cache.set(key, { at: now(), value });
            return value;
          })
          .finally(() => inflight.delete(key));
        inflight.set(key, p);
      }
      return p;
    },
    /** A release seen by an earlier load, or null. */
    get(owner, repo, tag) {
      return byTag.get(`${owner}/${repo}`.toLowerCase())?.get(tag) ?? null;
    },
    clear() {
      cache.clear();
      byTag.clear();
    },
  };
}
