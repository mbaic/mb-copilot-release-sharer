// Activity Sharer spike (docs/TESTING.md S1-S8): runs the one-request query for a single range through `gh`
// and prints counts, repos, rate-limit cost, agent-detection candidates and a redacted sample.
// Read-only. No token is read (gh authenticates). Usage: node scripts/spike-activity.mjs [--range 30d] [--no-redact]
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTIVITY_QUERY, RANGES, VIEWER_QUERY, activityVariables, ghGraphqlArgs, windowsFor } from "../plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/lib/query.mjs";
import { agentCandidates } from "../plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/lib/agent.mjs";

const execFileP = promisify(execFile);
const GH_TIMEOUT_MS = 30_000;

async function gh(args) {
  const { stdout } = await execFileP("gh", args, { timeout: GH_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024, windowsHide: true, encoding: "utf8" });
  return JSON.parse(stdout);
}

const mask = (s) => (String(s).length <= 2 ? "**" : `${String(s).slice(0, 2)}…`);
const redactRepo = (full) => full.split("/").map(mask).join("/");

/** Pure: turns the GraphQL response into the report object. */
export function summarize(data, windows, { redact = true } = {}) {
  const repoName = (n) => (redact ? redactRepo(n) : n);
  const sumBy = (groups) => (groups ?? []).reduce((n, g) => n + (g.contributions?.totalCount ?? 0), 0);
  const listed = (groups) => (groups ?? []).reduce((n, g) => n + (g.contributions?.nodes?.length ?? 0), 0);
  const cur = data.viewer?.cur ?? {};
  const prev = data.viewer?.prev ?? {};
  const groups = { prs: cur.pullRequestContributionsByRepository, reviews: cur.pullRequestReviewContributionsByRepository, issues: cur.issueContributionsByRepository };
  const repos = new Map();
  for (const [kind, gs] of Object.entries(groups)) {
    for (const g of gs ?? []) {
      const full = g.repository?.nameWithOwner;
      if (!full) continue;
      const row = repos.get(full) ?? { prs: 0, reviews: 0, issues: 0 };
      row[kind] += g.contributions?.totalCount ?? 0;
      repos.set(full, row);
    }
  }
  const mergedNodes = (data.merged?.nodes ?? []).filter(Boolean);
  const openNodes = (data.open?.nodes ?? []).filter(Boolean);
  const reqNodes = (data.reviewRequests?.nodes ?? []).filter(Boolean);
  const owners = new Set([...repos.keys()].map((r) => r.split("/")[0]));
  // Your own login is masked when redacting; other authors (bots such as Copilot) stay visible because they are the signal.
  const me = data.viewer?.login;
  const authors = (c) => (redact ? { ...c, authors: c.authors.map(([l, n]) => [l === me ? "<you>" : l, n]) } : c);
  const sample = mergedNodes.slice(0, 3).map((p) => ({
    repo: repoName(p.repository?.nameWithOwner ?? "?"),
    number: p.number,
    title: redact ? `<${String(p.title ?? "").length} chars>` : p.title,
    createdAt: p.createdAt,
    mergedAt: p.mergedAt,
    branchPrefix: p.headRefName?.includes("/") ? p.headRefName.split("/")[0] : null,
    author: redact && p.author?.login === me ? "<you>" : (p.author?.login ?? null),
  }));
  return {
    range: windows.range,
    window: windows.cur,
    previous: windows.prev,
    login: redact ? mask(data.viewer?.login ?? "?") : data.viewer?.login,
    counts: {
      current: { prsOpened: sumBy(groups.prs), reviews: sumBy(groups.reviews), issues: sumBy(groups.issues), restrictedContributions: cur.restrictedContributionsCount ?? null },
      previous: { prsOpened: prev.totalPullRequestContributions ?? null, reviews: prev.totalPullRequestReviewContributions ?? null, issues: prev.totalIssueContributions ?? null },
      listedNodes: { prs: listed(groups.prs), reviews: listed(groups.reviews), issues: listed(groups.issues) },
      mergedSearch: { issueCount: data.merged?.issueCount ?? null, nodes: mergedNodes.length },
      prevMergedSearch: { issueCount: data.prevMerged?.issueCount ?? null, nodes: (data.prevMerged?.nodes ?? []).filter(Boolean).length },
      open: { issueCount: data.open?.issueCount ?? null, nodes: openNodes.length },
      reviewRequests: { issueCount: data.reviewRequests?.issueCount ?? null, nodes: reqNodes.length },
    },
    repoCount: repos.size,
    orgCount: owners.size,
    repos: [...repos.entries()].map(([name, c]) => ({ repo: repoName(name), ...c })).sort((a, b) => b.prs + b.reviews + b.issues - (a.prs + a.reviews + a.issues)),
    rateLimit: data.rateLimit ?? null,
    agentCandidates: {
      merged: authors(agentCandidates(mergedNodes)),
      open: authors(agentCandidates(openNodes)),
    },
    sample,
  };
}

function parseArgs(argv) {
  const out = { range: "30d", redact: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--range") out.range = argv[++i];
    else if (argv[i] === "--no-redact") out.redact = false;
    else throw new Error(`unknown argument '${argv[i]}'`);
  }
  if (!RANGES[out.range]) throw new Error(`--range must be one of ${Object.keys(RANGES).join(", ")}`);
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const windows = windowsFor(opts.range);
  const { data: who } = await gh(ghGraphqlArgs(VIEWER_QUERY));
  const res = await gh(ghGraphqlArgs(ACTIVITY_QUERY, activityVariables(who.viewer.login, windows)));
  if (res.errors?.length) console.error(`spike-activity: GraphQL reported errors (partial data may follow):\n${JSON.stringify(res.errors.map((e) => ({ type: e.type, path: e.path, message: e.message })), null, 2)}`);
  console.log(JSON.stringify(summarize(res.data ?? {}, windows, { redact: opts.redact }), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    if (e?.code === "ENOENT") console.error("spike-activity: the GitHub CLI (gh) was not found on PATH.");
    else if (e?.stderr) console.error(`spike-activity: gh failed:\n${String(e.stderr).trim()}`);
    else console.error(`spike-activity: ${e?.message ?? e}`);
    process.exit(1);
  });
}
