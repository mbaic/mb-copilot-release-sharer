// "Agent-assisted" PR detection (spec section 5). Switched OFF until the owner reports spike check S7:
// with AGENT_DETECTION_VERIFIED false nothing is tagged, counted or shown. The spike helpers below stay
// available so the owner's real PRs can be inspected.

export const AGENT_DETECTION_VERIFIED = false;

const AGENT_AUTHORS = new Map([["copilot", "Copilot"], ["copilot-swe-agent", "Copilot"], ["copilot-swe-agent[bot]", "Copilot"]]);
const AGENT_PREFIXES = new Map([["copilot", "Copilot"], ["claude", "Claude"]]);

/** Branch prefix before the first "/" (lowercased), or null when the branch has none. */
export function branchPrefix(headRefName) {
  if (typeof headRefName !== "string") return null;
  const i = headRefName.indexOf("/");
  return i > 0 ? headRefName.slice(0, i).toLowerCase() : null;
}

/** Counts [value, n] pairs, most frequent first. Nullish values are skipped. */
export function tally(values) {
  const m = new Map();
  for (const v of values) if (v != null) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

/** Prefix and author tallies over PR nodes ({ headRefName, author: { login } }). */
export function agentCandidates(prs) {
  return {
    branchPrefixes: tally(prs.map((p) => branchPrefix(p?.headRefName))),
    authors: tally(prs.map((p) => p?.author?.login)),
  };
}

/** Returns { agent, rule } for a PR node, or null. Rule 1: agent bot author. Rule 2: agent branch prefix. */
export function classifyAgent(pr) {
  const byAuthor = AGENT_AUTHORS.get(String(pr?.author?.login ?? "").toLowerCase());
  if (byAuthor) return { agent: byAuthor, rule: "author" };
  const byPrefix = AGENT_PREFIXES.get(branchPrefix(pr?.headRefName));
  if (byPrefix) return { agent: byPrefix, rule: "branch" };
  return null;
}
