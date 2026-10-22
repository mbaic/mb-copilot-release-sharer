// Pure: turns the one GraphQL response into the view model the canvas, the summary, the write-up and
// get_activity all share. The org filter is applied here, client-side. Field names follow the query in
// lib/query.mjs (still unverified until spike S1).
import { AGENT_DETECTION_VERIFIED, classifyAgent } from "./agent.mjs";

export const STALE_DAYS = 7;
export const MAX_NODES = 100;
const DAY_MS = 86_400_000;

const ownerOf = (full) => String(full ?? "").split("/")[0];
const list = (x) => (Array.isArray(x) ? x.filter(Boolean) : []);
const t = (iso) => Date.parse(iso ?? "") || 0;
const day = (iso) => (iso ? String(iso).slice(0, 10) : null);

/** Median of a number list, or null when empty. */
export function median(values) {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const mergeDays = (nodes) => median(list(nodes).filter((p) => p.createdAt && p.mergedAt).map((p) => (t(p.mergedAt) - t(p.createdAt)) / DAY_MS));
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

function bucketPlan(days) {
  if (days <= 7) return { unit: "day", size: 1 };
  if (days <= 90) return { unit: "week", size: 7 };
  return { unit: "month", size: 30 };
}

/**
 * @param {object} data     GraphQL `data` object
 * @param {{range:string, days:number, cur:{from:string,to:string}, prev:{from:string,to:string}}} windows
 * @param {{orgs?:string[]|null, now?:Date, agent?:boolean}} [opts]  orgs: organizations/users to include; empty or all of them = no filter
 */
export function aggregate(data, windows, { orgs = null, now = new Date(), agent = AGENT_DETECTION_VERIFIED } = {}) {
  const viewer = data?.viewer ?? {};
  const login = viewer.login ?? null;
  const cur = viewer.cur ?? {};
  const prev = viewer.prev ?? {};
  const tag = (pr) => (agent ? classifyAgent(pr) : null);

  // Every org seen anywhere, before filtering.
  const orgSet = new Set();
  const groups = {
    prs: list(cur.pullRequestContributionsByRepository),
    reviews: list(cur.pullRequestReviewContributionsByRepository),
    issues: list(cur.issueContributionsByRepository),
  };
  for (const gs of Object.values(groups)) for (const g of gs) if (g.repository?.nameWithOwner) orgSet.add(ownerOf(g.repository.nameWithOwner));
  const mergedAll = list(data?.merged?.nodes);
  const openAll = list(data?.open?.nodes);
  const reqAll = list(data?.reviewRequests?.nodes);
  for (const p of [...mergedAll, ...openAll, ...reqAll]) if (p.repository?.nameWithOwner) orgSet.add(ownerOf(p.repository.nameWithOwner));

  // The filter is active only when some, but not all, of the known organizations are selected.
  const wanted = new Set(Array.isArray(orgs) ? orgs : []);
  const filtered = wanted.size > 0 && [...orgSet].some((o) => !wanted.has(o));
  const inOrg = (full) => !filtered || wanted.has(ownerOf(full));

  const repos = new Map();
  const row = (full) => {
    if (!repos.has(full)) repos.set(full, { repo: full, owner: ownerOf(full), merged: 0, reviews: 0, issues: 0 });
    return repos.get(full);
  };

  // Merged: every PR the user authored that merged inside the window (search, not contributionsCollection).
  const mergedNodes = mergedAll.filter((p) => inOrg(p.repository?.nameWithOwner));
  const mergedItems = mergedNodes
    .map((p) => ({ title: p.title, url: p.url, repo: p.repository?.nameWithOwner, number: p.number, date: day(p.mergedAt), agent: tag(p)?.agent ?? null }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  for (const p of mergedNodes) row(p.repository.nameWithOwner).merged++;

  // Opened PRs, reviews and issues come from contributionsCollection, grouped by repository.
  const openedItems = [];
  let openedCount = 0;
  let stillOpen = 0;
  for (const g of groups.prs.filter((x) => inOrg(x.repository?.nameWithOwner))) {
    openedCount += g.contributions?.totalCount ?? 0;
    for (const n of list(g.contributions?.nodes)) {
      const pr = n.pullRequest;
      if (!pr) continue;
      if (pr.state === "OPEN") stillOpen++;
      openedItems.push({ title: pr.title, url: pr.url, repo: g.repository.nameWithOwner, number: pr.number, date: day(pr.createdAt), state: pr.state });
    }
  }
  const reviewItems = [];
  let reviewCount = 0;
  const reviewedPrs = new Map(); // url -> state
  const people = new Set();
  for (const g of groups.reviews.filter((x) => inOrg(x.repository?.nameWithOwner))) {
    const full = g.repository.nameWithOwner;
    reviewCount += g.contributions?.totalCount ?? 0;
    row(full).reviews += g.contributions?.totalCount ?? 0;
    for (const n of list(g.contributions?.nodes)) {
      const pr = n.pullRequest;
      if (!pr) continue;
      const who = pr.author?.login ?? null;
      if (who && who !== login) people.add(who);
      reviewedPrs.set(pr.url, pr.state);
      reviewItems.push({ title: pr.title, url: pr.url, repo: full, number: pr.number, date: day(n.occurredAt), author: who });
    }
  }
  const issueItems = [];
  let issueCount = 0;
  let issuesClosed = 0;
  for (const g of groups.issues.filter((x) => inOrg(x.repository?.nameWithOwner))) {
    const full = g.repository.nameWithOwner;
    issueCount += g.contributions?.totalCount ?? 0;
    row(full).issues += g.contributions?.totalCount ?? 0;
    for (const n of list(g.contributions?.nodes)) {
      const i = n.issue;
      if (!i) continue;
      if (i.state === "CLOSED") issuesClosed++;
      issueItems.push({ title: i.title, url: i.url, repo: full, number: i.number, date: day(i.createdAt), state: i.state });
    }
  }
  const byDateDesc = (a, b) => (b.date ?? "").localeCompare(a.date ?? "");
  openedItems.sort(byDateDesc);
  reviewItems.sort(byDateDesc);
  issueItems.sort(byDateDesc);

  // Merged count: the search's own total when unfiltered, else what was listed for the org.
  const mergedCount = filtered ? mergedItems.length : (data?.merged?.issueCount ?? mergedItems.length);
  const prevMergedNodes = list(data?.prevMerged?.nodes).filter((p) => inOrg(p.repository?.nameWithOwner));
  const prevMergedComplete = (data?.prevMerged?.issueCount ?? prevMergedNodes.length) <= list(data?.prevMerged?.nodes).length;
  const prevMergedCount = filtered ? (prevMergedComplete ? prevMergedNodes.length : null) : (data?.prevMerged?.issueCount ?? null);

  // Per-org totals for the other tiles are not available for the previous window: no delta when filtered.
  const prevOrNull = (v) => (filtered ? null : (v ?? null));

  const repoRows = [...repos.values()].sort((a, b) => (b.merged + b.reviews + b.issues) - (a.merged + a.reviews + a.issues) || a.repo.localeCompare(b.repo));
  const grand = repoRows.reduce((n, r) => n + r.merged + r.reviews + r.issues, 0);
  const top = repoRows[0];
  const shipped = [...reviewedPrs.values()].filter((s) => s === "MERGED").length;
  const agentMerged = agent ? mergedItems.filter((i) => i.agent).length : null;
  const agentNames = agent ? [...new Set(mergedItems.map((i) => i.agent).filter(Boolean))] : [];

  const age = (iso) => Math.max(0, Math.floor((now.getTime() - t(iso)) / DAY_MS));
  const openPrs = openAll.filter((p) => inOrg(p.repository?.nameWithOwner)).map((p) => ({
    title: p.title, url: p.url, repo: p.repository?.nameWithOwner, number: p.number, ageDays: age(p.createdAt),
    stale: age(p.createdAt) > STALE_DAYS, draft: Boolean(p.isDraft), agent: tag(p)?.agent ?? null,
  })).sort((a, b) => b.ageDays - a.ageDays);
  const reviewRequests = reqAll.filter((p) => inOrg(p.repository?.nameWithOwner)).map((p) => ({
    title: p.title, url: p.url, repo: p.repository?.nameWithOwner, number: p.number, author: p.author?.login ?? null, ageDays: age(p.createdAt),
  })).sort((a, b) => b.ageDays - a.ageDays);

  // Chart: fixed-length buckets from the window start; the last one may be partial.
  const plan = bucketPlan(windows.days);
  const start = t(windows.cur.from);
  const end = t(windows.cur.to);
  const count = Math.max(1, Math.ceil((end - start) / (plan.size * DAY_MS)));
  const buckets = Array.from({ length: count }, (_, i) => {
    const from = start + i * plan.size * DAY_MS;
    const to = Math.min(end, from + plan.size * DAY_MS);
    return { from: new Date(from).toISOString().slice(0, 10), days: Math.round((to - from) / DAY_MS), merged: 0, reviews: 0 };
  });
  const place = (iso, key) => {
    const i = Math.floor((t(iso) - start) / (plan.size * DAY_MS));
    if (i >= 0 && i < count) buckets[i][key]++;
  };
  for (const p of mergedNodes) place(p.mergedAt, "merged");
  for (const g of groups.reviews.filter((x) => inOrg(x.repository?.nameWithOwner))) for (const n of list(g.contributions?.nodes)) place(n.occurredAt, "reviews");

  const cap = (total, listed) => total != null && total > listed;
  const limits = {
    restrictedContributions: cur.restrictedContributionsCount ?? 0,
    merged: cap(data?.merged?.issueCount, list(data?.merged?.nodes).length),
    open: cap(data?.open?.issueCount, openAll.length),
    reviewRequests: cap(data?.reviewRequests?.issueCount, reqAll.length),
    repos: Object.values(groups).some((gs) => gs.length >= MAX_NODES),
    perRepo: Object.values(groups).some((gs) => gs.some((g) => cap(g.contributions?.totalCount, list(g.contributions?.nodes).length))),
    prevMerged: !prevMergedComplete,
  };

  return {
    login,
    range: windows.range,
    days: windows.days,
    window: windows.cur,
    previous: windows.prev,
    selectedOrgs: filtered ? [...wanted].sort((a, b) => a.localeCompare(b)) : [],
    orgs: [...orgSet].sort((a, b) => a.localeCompare(b)),
    tiles: {
      merged: { count: mergedCount, prev: prevMergedCount, items: mergedItems },
      opened: { count: openedCount, prev: prevOrNull(prev.totalPullRequestContributions), stillOpen, items: openedItems },
      reviews: { count: reviewCount, prev: prevOrNull(prev.totalPullRequestReviewContributions), people: people.size, items: reviewItems },
      issues: { count: issueCount, prev: prevOrNull(prev.totalIssueContributions), closed: issuesClosed, items: issueItems },
    },
    insights: {
      medianMergeDays: round1(mergeDays(mergedNodes)),
      prevMedianMergeDays: prevMergedComplete || !filtered ? round1(mergeDays(prevMergedNodes)) : null,
      reviewedShipped: { shipped, total: reviewedPrs.size },
      topRepo: top && repoRows.length > 1 && grand > 0 ? { repo: top.repo, share: Math.round((100 * (top.merged + top.reviews + top.issues)) / grand) } : null,
      agentMerged: agent ? { count: agentMerged, total: mergedItems.length, names: agentNames } : null,
    },
    openPrs,
    openCount: filtered ? openPrs.length : (data?.open?.issueCount ?? openPrs.length),
    reviewRequests,
    chart: { unit: plan.unit, buckets },
    repos: repoRows,
    repoCountMerged: new Set(mergedItems.map((i) => i.repo)).size,
    limits,
    agentEnabled: agent,
  };
}
