// Runs the real instance server with mocked dependencies, to work on the UI without Copilot or gh.
//   npm run dev [-- --error=gh_missing|gh_not_authenticated|rate_limited|repo_not_found|network|empty|norepo|unsupported_host] [--no-rewrite]
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startInstanceServer } from "../plugins/release-sharer/com.github.copilot/extensions/release-sharer/src/server.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const extDir = `${root}plugins/release-sharer/com.github.copilot/extensions/release-sharer`;
const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const errorMode = flag("error");
const PAGE = 30;

// Fixtures use the raw GitHub shape; the real src/github.mjs maps it like this.
const fixtureDir = `${root}test/fixtures/`;
const fixtures = readdirSync(fixtureDir).filter((f) => f.endsWith(".release.json") && !f.startsWith("xss"))
  .map((f) => JSON.parse(readFileSync(fixtureDir + f, "utf8")));
const map = (r, i) => ({
  id: r.id ?? 1000 + i, tag: r.tag_name, name: r.name ?? "", body: r.body ?? "", draft: false, prerelease: Boolean(r.prerelease),
  publishedAt: r.published_at ?? null, createdAt: r.created_at ?? null, url: r.html_url, author: r.author?.login ?? "", latest: false,
});

const day = 86_400_000;
const generated = Array.from({ length: 70 }, (_, i) => {
  const minor = 69 - i;
  const pre = i % 9 === 4;
  const tag = `v2.3.${minor}${pre ? "-rc.1" : ""}`;
  return map({
    id: 10 + i, tag_name: tag, name: pre ? `Release candidate ${minor}` : `Maintenance release ${minor}`, prerelease: pre,
    published_at: new Date(Date.parse("2026-09-30T08:00:00Z") - i * 6 * day).toISOString(),
    html_url: `https://github.com/acme/bc-app/releases/tag/${tag}`,
    body: `## What's Changed\n* Fix number ${minor} by @alice in https://github.com/acme/bc-app/pull/${300 + minor}\n* Improve docs (#${200 + minor})\n\n**Full Changelog**: https://github.com/acme/bc-app/compare/a...b`,
  }, i);
});
generated.push(map({ id: 5, tag_name: "v2.0.0", name: "", published_at: "2026-01-01T00:00:00Z", html_url: "https://github.com/acme/bc-app/releases/tag/v2.0.0", body: "" }, 0));
const preview = map({
  id: 6, tag_name: "v2.4.0-rc.1", name: "Release candidate", prerelease: true, published_at: "2026-10-02T08:00:00Z",
  html_url: "https://github.com/acme/bc-app/releases/tag/v2.4.0-rc.1", body: "* First candidate with bulk payment terms (#470)\n* Known issue: VAT rounding",
}, 0);
const all = [...fixtures.map(map), preview, ...generated]
  .sort((a, b) => Date.parse(b.publishedAt ?? b.createdAt) - Date.parse(a.publishedAt ?? a.createdAt));
const latest = all.find((r) => !r.prerelease);
if (latest) latest.latest = true;

const state = {
  v: 1,
  ui: { listWidth: 300, listCollapsed: false, format: "plain", clean: true, contributors: true, link: true, prs: true, audience: "Customers" },
  repos: {},
};
const merge = (t, p) => { for (const [k, v] of Object.entries(p)) { if (v && typeof v === "object" && !Array.isArray(v)) merge((t[k] ??= {}), v); else t[k] = v; } };

let repo = "acme/bc-app";
let repoError;
if (errorMode === "norepo") { repo = null; repoError = { code: "not_a_repo" }; }
if (errorMode === "unsupported_host") { repo = null; repoError = { code: "unsupported_host" }; }

const errors = {
  gh_missing: { code: "gh_missing", message: "gh not found" },
  gh_not_authenticated: { code: "gh_not_authenticated", message: "not signed in" },
  rate_limited: { code: "rate_limited", message: "rate limited", resetAt: Math.floor(Date.now() / 1000) + 3600 },
  repo_not_found: { code: "repo_not_found", message: "not found" },
  network: { code: "network", message: "network down" },
};

const server = await startInstanceServer({
  extDir, version: "dev", features: { rewrite: !process.argv.includes("--no-rewrite") },
  getRepo: () => ({ repo, ...(repoError ? { repoError } : {}) }),
  setRepo: async (value) => {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) return { error: { code: "invalid_repo", message: "That doesn't look like owner/repo." } };
    repo = value;
    repoError = undefined;
    return { repo };
  },
  state: { get: () => state, patch: (p) => { merge(state, p); console.log("patch", JSON.stringify(p)); return state; } },
  loadPrs: async ({ tag }) => ({ // mock: one extra PR found "in the commits"
    prs: [{ number: 999, url: `https://github.com/acme/bc-app/pull/999`, title: `Commit-only change in ${tag}` }], partial: false,
  }),
  loadReleases: async ({ page }) => {
    await new Promise((r) => setTimeout(r, 250));
    if (errors[errorMode]) return { error: errors[errorMode] };
    if (errorMode === "empty") return { releases: [], hasMore: false, page: 1 };
    const slice = all.slice((page - 1) * PAGE, page * PAGE);
    return { releases: slice, hasMore: page * PAGE < all.length, page };
  },
  rewrite: async ({ tag, audience }) => {
    console.log(`rewrite ${tag} for ${audience}`);
    setTimeout(() => server.broadcast("draft", {
      tag, text: `This is a fake ${audience.toLowerCase()} summary of ${tag}. It was written by the dev server, not an agent.`, note: "dev server",
    }), 1500);
  },
  log: { error: (m) => console.error(m) },
});

console.log(`Release Sharer dev server\n${server.url}`);
