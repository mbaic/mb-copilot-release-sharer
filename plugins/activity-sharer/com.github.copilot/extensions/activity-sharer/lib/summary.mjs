// Rule-based summary (no AI): one factual headline and a supporting line of up to two facts, in priority order.
// Plain facts only: no adjectives, no praise; decreases are stated neutrally. Every number is a figure the canvas shows.
import { STALE_DAYS } from "./aggregate.mjs";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "1.8 days", "1 day", "6 hours". */
export function formatDays(d) {
  if (d < 1) {
    const h = Math.max(1, Math.round(d * 24));
    return plural(h, "hour");
  }
  return `${d} ${d === 1 ? "day" : "days"}`;
}

function headline(m) {
  const merged = m.tiles.merged.count;
  const reviews = m.tiles.reviews.count;
  const opened = m.tiles.opened.count;
  const issues = m.tiles.issues.count;
  if (!merged && !reviews && !opened && !issues) return "No PRs, reviews or issues in this period.";
  const repos = m.repoCountMerged;
  const people = m.tiles.reviews.people;
  const parts = [];
  if (merged) parts.push(`merged ${plural(merged, "pull request")}${repos ? ` in ${plural(repos, "repository", "repositories")}` : ""}`);
  if (reviews) parts.push(`gave ${plural(reviews, "review")}${people ? ` for ${plural(people, "person", "people")}` : ""}`);
  if (parts.length) return `You ${parts.join(" and ")}.`;
  // Quiet: nothing merged or reviewed, so name what was done.
  const did = [];
  if (opened) did.push(plural(opened, "pull request"));
  if (issues) did.push(plural(issues, "issue"));
  return `No PRs merged or reviews given. You opened ${did.join(" and ")}.`;
}

function facts(m) {
  const out = [];
  const { count, prev } = m.tiles.merged;
  if (prev != null && !m.limits.prevMerged) {
    if (count > prev) out.push(`Merged PRs are up from ${prev}.`);
    else if (count < prev) out.push(`Merged PRs are down from ${prev}.`);
    else if (count > 0) out.push(`Merged PRs are the same as the previous period (${prev}).`);
  }
  const { medianMergeDays: now, prevMedianMergeDays: was } = m.insights;
  if (now != null && was != null && now !== was) {
    out.push(now < was
      ? `Your PRs merged faster (median ${formatDays(now)}, was ${was}).`
      : `Median time to merge is ${formatDays(now)}, was ${was}.`);
  }
  const { shipped, total } = m.insights.reviewedShipped;
  if (shipped > 0) out.push(`${shipped} of the ${plural(total, "PR")} you reviewed ${shipped === 1 ? "has" : "have"} shipped.`);
  const top = m.insights.topRepo;
  if (top) out.push(`Most of your work was in ${top.repo} (${top.share}%).`);
  const stale = m.openPrs.filter((p) => p.stale).length;
  if (stale) out.push(`${stale === 1 ? "1 open PR is" : `${stale} open PRs are`} older than ${STALE_DAYS} days.`);
  return out;
}

/** @returns {{headline:string, support:string}} */
export function summarize(model) {
  return { headline: headline(model), support: facts(model).slice(0, 2).join(" ") };
}
