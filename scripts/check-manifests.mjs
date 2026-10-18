// Fails when manifests drift: versions, $schema, source paths, entry file, preview image (PLAN section 6).
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const EXT_REL = "com.github.copilot/extensions/release-sharer";

/** Returns a list of problem strings; empty means all good. */
export function checkManifests(root) {
  const errors = [];
  const readJson = (rel) => {
    try {
      return JSON.parse(readFileSync(join(root, rel), "utf8"));
    } catch (e) {
      errors.push(`${rel}: cannot read or parse (${e.message})`);
      return null;
    }
  };

  const marketplace = readJson(".github/plugin/marketplace.json");
  const plugin = readJson("plugins/release-sharer/plugin.json");
  const extDir = join("plugins/release-sharer", EXT_REL);
  const pkg = readJson(join(extDir, "package.json"));

  if (plugin) {
    if (plugin.$schema !== SCHEMA) errors.push(`plugin.json: $schema must be ${SCHEMA}`);
    if (!plugin.name) errors.push("plugin.json: name is required");
    const logo = plugin.extensions?.["com.github.copilot"]?.logo;
    // The logo resolves inside the extension folder (PLAN section 3.1).
    if (!logo || !existsSync(join(root, extDir, logo))) errors.push(`plugin.json: logo '${logo}' not found in ${extDir}`);
  }

  if (marketplace) {
    if (!marketplace.name) errors.push("marketplace.json: name is required");
    if (typeof marketplace.owner !== "object" || !marketplace.owner?.name) errors.push("marketplace.json: owner must be an object with name");
    if (!Array.isArray(marketplace.plugins) || !marketplace.plugins.length) errors.push("marketplace.json: plugins[] is required");
    for (const p of marketplace.plugins ?? []) {
      if (!p.name || typeof p.source !== "string") errors.push(`marketplace.json: plugin entry needs name and a string source (${p.name ?? "?"})`);
      else if (!existsSync(join(root, p.source, "plugin.json"))) errors.push(`marketplace.json: source '${p.source}' has no plugin.json`);
    }
  }

  const changelogVersion = (() => {
    try {
      return /^##\s+\[?(\d+\.\d+\.\d+)\]?/m.exec(readFileSync(join(root, "CHANGELOG.md"), "utf8"))?.[1] ?? null;
    } catch {
      return null;
    }
  })();
  if (!changelogVersion) errors.push("CHANGELOG.md: no '## x.y.z' heading found");

  const versions = {
    "plugin.json": plugin?.version,
    "marketplace.json metadata": marketplace?.metadata?.version,
    "marketplace.json plugin": marketplace?.plugins?.[0]?.version,
    "extension package.json": pkg?.version,
    "CHANGELOG.md": changelogVersion,
  };
  if (new Set(Object.values(versions)).size !== 1) errors.push(`versions differ: ${JSON.stringify(versions)}`);

  if (pkg?.dependencies && Object.keys(pkg.dependencies).length) errors.push("extension package.json: no runtime dependencies allowed");
  if (pkg?.dependencies?.["@github/copilot-sdk"] || pkg?.devDependencies?.["@github/copilot-sdk"]) errors.push("@github/copilot-sdk is host-provided; remove it from package.json");

  if (!existsSync(join(root, extDir, "extension.mjs"))) errors.push(`${extDir}/extension.mjs is missing`);

  const png = join(root, extDir, "assets/preview.png");
  if (!existsSync(png)) errors.push(`${extDir}/assets/preview.png is missing`);
  else {
    const buf = readFileSync(png);
    if (buf.length > 5 * 1024 * 1024) errors.push("preview.png is larger than 5 MB");
    if (buf.length < 24 || buf.toString("latin1", 1, 4) !== "PNG") errors.push("preview.png is not a PNG");
    else if (buf.readUInt32BE(16) < 400 || buf.readUInt32BE(20) < 160) errors.push(`preview.png is ${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}, needs at least 400x160`);
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const errors = checkManifests(root);
  if (errors.length) {
    for (const e of errors) console.error(`check-manifests: ${e}`);
    process.exit(1);
  }
  console.log("check-manifests: ok");
}
