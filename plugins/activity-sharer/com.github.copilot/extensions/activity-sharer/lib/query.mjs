// Pure builders for the one GraphQL request per range (spec section 4). Field names, limits and `@me`
// support are unverified until spike checks S1 and S6 are reported.

/** Range key -> window length in days. 12 months is 365 days so one contributionsCollection call can cover it. */
export const RANGES = { "7d": 7, "30d": 30, "90d": 90, "6m": 180, "12m": 365 };

const DAY_MS = 86_400_000;
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export const isValidLogin = (s) => typeof s === "string" && LOGIN_RE.test(s);
export const isIsoUtc = (s) => typeof s === "string" && ISO_RE.test(s) && !Number.isNaN(Date.parse(s));

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Rolling windows ending at `now`: the current one and the previous one of equal length. */
export function windowsFor(range, now = new Date()) {
  const days = RANGES[range];
  if (!days) throw new Error(`unknown range '${range}' (use ${Object.keys(RANGES).join(", ")})`);
  const to = Math.floor(now.getTime() / 1000) * 1000;
  const from = to - days * DAY_MS;
  return { range, days, cur: { from: iso(from), to: iso(to) }, prev: { from: iso(from - days * DAY_MS), to: iso(from) } };
}

/** Search strings for the four searches. The login is validated; dates come from windowsFor. */
export function searchStrings(login, windows) {
  if (!isValidLogin(login)) throw new Error("invalid login");
  for (const d of [windows.cur.from, windows.cur.to, windows.prev.from, windows.prev.to]) if (!isIsoUtc(d)) throw new Error("invalid date");
  return {
    qMerged: `is:pr author:${login} merged:${windows.cur.from}..${windows.cur.to}`,
    qPrevMerged: `is:pr author:${login} merged:${windows.prev.from}..${windows.prev.to}`,
    qOpen: `is:pr is:open author:${login} archived:false`,
    qReq: `is:pr is:open review-requested:${login} archived:false`,
  };
}

export const VIEWER_QUERY = "query { viewer { login } }";

export const ACTIVITY_QUERY = `query($from: DateTime!, $to: DateTime!, $pfrom: DateTime!, $pto: DateTime!,
      $qMerged: String!, $qPrevMerged: String!, $qOpen: String!, $qReq: String!) {
  viewer {
    login
    cur: contributionsCollection(from: $from, to: $to) {
      restrictedContributionsCount
      pullRequestContributionsByRepository(maxRepositories: 100) {
        repository { nameWithOwner owner { login } }
        contributions(first: 100) { totalCount nodes { pullRequest { number title url state createdAt } } }
      }
      pullRequestReviewContributionsByRepository(maxRepositories: 100) {
        repository { nameWithOwner owner { login } }
        contributions(first: 100) { totalCount nodes { occurredAt pullRequest { number title url state author { login } } } }
      }
      issueContributionsByRepository(maxRepositories: 100) {
        repository { nameWithOwner owner { login } }
        contributions(first: 100) { totalCount nodes { issue { number title url state createdAt } } }
      }
    }
    prev: contributionsCollection(from: $pfrom, to: $pto) {
      totalPullRequestContributions totalPullRequestReviewContributions totalIssueContributions
    }
  }
  merged: search(type: ISSUE, query: $qMerged, first: 100) {
    issueCount
    nodes { ... on PullRequest { number title url createdAt mergedAt headRefName author { login }
            repository { nameWithOwner owner { login } } } }
  }
  prevMerged: search(type: ISSUE, query: $qPrevMerged, first: 100) {
    issueCount
    nodes { ... on PullRequest { createdAt mergedAt repository { nameWithOwner } } }
  }
  open: search(type: ISSUE, query: $qOpen, first: 50) {
    issueCount nodes { ... on PullRequest { number title url createdAt isDraft headRefName author { login } repository { nameWithOwner } } }
  }
  reviewRequests: search(type: ISSUE, query: $qReq, first: 50) {
    issueCount nodes { ... on PullRequest { number title url createdAt author { login } repository { nameWithOwner } } }
  }
  rateLimit { cost remaining }
}`;

/** Argument array for `gh api graphql`. Variables use -f (raw strings), so nothing is type-coerced or read from a file. */
export function ghGraphqlArgs(query, variables = {}) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(variables)) args.push("-f", `${k}=${v}`);
  return args;
}

/** Variables for ACTIVITY_QUERY. */
export function activityVariables(login, windows) {
  return {
    from: windows.cur.from, to: windows.cur.to, pfrom: windows.prev.from, pto: windows.prev.to,
    ...searchStrings(login, windows),
  };
}
