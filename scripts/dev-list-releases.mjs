// Dev check against real data: node scripts/dev-list-releases.mjs owner/repo [--format plain|markdown|email|html]
// Lists the first page of releases through gh; with --format, renders the newest one.
import { createReleaseLoader, isValidRepo } from "../plugins/release-sharer/com.github.copilot/extensions/release-sharer/src/github.mjs";
import { buildModel } from "../plugins/release-sharer/com.github.copilot/extensions/release-sharer/lib/model.mjs";
import { format } from "../plugins/release-sharer/com.github.copilot/extensions/release-sharer/lib/formatters.mjs";

const args = process.argv.slice(2);
const fi = args.indexOf("--format");
const fmt = fi >= 0 ? args.splice(fi, 2)[1] : null;
const full = args[0];
if (!isValidRepo(full) || (fmt && !["plain", "markdown", "email", "html"].includes(fmt))) {
  console.error("Usage: node scripts/dev-list-releases.mjs owner/repo [--format plain|markdown|email|html]");
  process.exit(2);
}

const [owner, repo] = full.split("/");
const res = await createReleaseLoader().load({ owner, repo });
if (res.error) {
  console.error(`${res.error.code}: ${res.error.message}\n${res.error.hint}`);
  process.exit(1);
}
for (const r of res.releases) {
  const flags = [r.latest && "latest", r.prerelease && "pre-release"].filter(Boolean).join(",");
  console.log(`${r.tag}\t${(r.publishedAt ?? r.createdAt ?? "").slice(0, 10)}\t${flags}`);
}
console.log(`-- ${res.releases.length} releases, hasMore=${res.hasMore}`);

if (fmt && res.releases[0]) {
  const out = format(buildModel(res.releases[0]), { format: fmt, repoLabel: full });
  console.log(`\n${out.subject ? `Subject: ${out.subject}\n\n` : ""}${out.html ?? out.body}`);
}
