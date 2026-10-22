// Enumerates the plugins listed in the marketplace, with the paths every script needs.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Returns [{ name, source, dir, extRel, changelogRel, entry }] for each marketplace plugin (relative paths, forward slashes). */
export function listPlugins(root) {
  let marketplace;
  try {
    marketplace = JSON.parse(readFileSync(join(root, ".github/plugin/marketplace.json"), "utf8"));
  } catch {
    return [];
  }
  return (marketplace.plugins ?? [])
    .filter((p) => typeof p?.name === "string" && typeof p?.source === "string")
    .map((p) => {
      const extRel = `com.github.copilot/extensions/${p.name}`;
      return {
        name: p.name,
        source: p.source,
        extRel,
        entry: `${p.source}/${extRel}/extension.mjs`,
        // Release Sharer's changelog stayed at the repo root; every other plugin keeps its own.
        changelogRel: p.name === "release-sharer" ? "CHANGELOG.md" : `${p.source}/CHANGELOG.md`,
      };
    });
}
