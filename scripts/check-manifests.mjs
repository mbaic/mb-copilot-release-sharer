// Fails when manifests drift: versions, $schema, source paths, entry file, preview image. Checks every marketplace plugin.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listPlugins } from "./plugins.mjs";

const SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const SEMVER = /^\d+\.\d+\.\d+$/;

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
  if (marketplace) {
    if (!marketplace.name) errors.push("marketplace.json: name is required");
    if (typeof marketplace.owner !== "object" || !marketplace.owner?.name) errors.push("marketplace.json: owner must be an object with name");
    if (!Array.isArray(marketplace.plugins) || !marketplace.plugins.length) errors.push("marketplace.json: plugins[] is required");
    // The marketplace version only moves when the plugin list changes, so it is checked for shape, not against a plugin.
    if (!SEMVER.test(marketplace.metadata?.version ?? "")) errors.push("marketplace.json: metadata.version must be x.y.z");
    const names = (marketplace.plugins ?? []).map((p) => p.name);
    if (new Set(names).size !== names.length) errors.push("marketplace.json: duplicate plugin names");
  }

  for (const p of marketplace?.plugins ?? []) {
    if (!p.name || typeof p.source !== "string") errors.push(`marketplace.json: plugin entry needs name and a string source (${p.name ?? "?"})`);
  }

  for (const info of listPlugins(root)) errors.push(...checkPlugin(root, info, marketplace, readJson));
  return errors;
}

function checkPlugin(root, { name, source, extRel, changelogRel }, marketplace, readJson) {
  const errors = [];
  const tag = `plugin ${name}`;
  if (!existsSync(join(root, source, "plugin.json"))) return [`marketplace.json: source '${source}' has no plugin.json`];

  const plugin = readJson(`${source}/plugin.json`);
  const extDir = `${source}/${extRel}`;
  const pkg = readJson(`${extDir}/package.json`);

  if (plugin) {
    if (plugin.$schema !== SCHEMA) errors.push(`${tag}: plugin.json $schema must be ${SCHEMA}`);
    if (plugin.name !== name) errors.push(`${tag}: plugin.json name must be '${name}'`);
    const logo = plugin.extensions?.["com.github.copilot"]?.logo;
    // The logo resolves inside the extension folder.
    if (!logo || !existsSync(join(root, extDir, logo))) errors.push(`${tag}: plugin.json logo '${logo}' not found in ${extDir}`);
  }
  if (pkg && pkg.name !== name) errors.push(`${tag}: extension package.json name must be '${name}'`);

  const changelogVersion = (() => {
    try {
      return /^##\s+\[?(\d+\.\d+\.\d+)\]?/m.exec(readFileSync(join(root, changelogRel), "utf8"))?.[1] ?? null;
    } catch {
      return null;
    }
  })();
  if (!changelogVersion) errors.push(`${tag}: ${changelogRel} has no '## x.y.z' heading`);

  const versions = {
    "plugin.json": plugin?.version,
    "marketplace.json plugin": marketplace?.plugins?.find((p) => p.name === name)?.version,
    "extension package.json": pkg?.version,
    [changelogRel]: changelogVersion,
  };
  if (new Set(Object.values(versions)).size !== 1) errors.push(`${tag}: versions differ: ${JSON.stringify(versions)}`);

  if (pkg?.dependencies && Object.keys(pkg.dependencies).length) errors.push(`${tag}: extension package.json: no runtime dependencies allowed`);
  if (pkg?.dependencies?.["@github/copilot-sdk"] || pkg?.devDependencies?.["@github/copilot-sdk"]) errors.push(`${tag}: @github/copilot-sdk is host-provided; remove it from package.json`);

  // Skills are discovered from skills/<name>/SKILL.md; frontmatter name must match the folder.
  const skillsDir = join(root, source, "skills");
  if (existsSync(skillsDir)) {
    for (const skill of readdirSync(skillsDir)) {
      let text = "";
      try { text = readFileSync(join(skillsDir, skill, "SKILL.md"), "utf8"); } catch { errors.push(`${tag}: skills/${skill}: SKILL.md is missing`); continue; }
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
      if (new RegExp(`^name:\\s*${skill}\\s*$`, "m").test(fm) === false) errors.push(`${tag}: skills/${skill}: frontmatter name must be '${skill}'`);
      if (!/^description:\s*\S/m.test(fm)) errors.push(`${tag}: skills/${skill}: frontmatter description is required`);
    }
  }

  if (!existsSync(join(root, extDir, "extension.mjs"))) errors.push(`${tag}: ${extDir}/extension.mjs is missing`);

  const png = join(root, extDir, "assets/preview.png");
  if (!existsSync(png)) errors.push(`${tag}: ${extDir}/assets/preview.png is missing`);
  else {
    const buf = readFileSync(png);
    if (buf.length > 5 * 1024 * 1024) errors.push(`${tag}: preview.png is larger than 5 MB`);
    if (buf.length < 24 || buf.toString("latin1", 1, 4) !== "PNG") errors.push(`${tag}: preview.png is not a PNG`);
    else if (buf.readUInt32BE(16) < 400 || buf.readUInt32BE(20) < 160) errors.push(`${tag}: preview.png is ${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}, needs at least 400x160`);
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
  console.log(`check-manifests: ok (${listPlugins(root).map((p) => p.name).join(", ")})`);
}
