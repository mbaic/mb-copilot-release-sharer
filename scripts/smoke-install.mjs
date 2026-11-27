// Install smoke test: isolated COPILOT_HOME, add this repo as a marketplace,
// install every plugin in it, assert each is listed and its extension entry exists. Needs the `copilot` CLI on PATH.
// Local step before every release; run with: npm run smoke
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listPlugins } from "./plugins.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const marketplace = JSON.parse(readFileSync(join(root, ".github/plugin/marketplace.json"), "utf8")).name;
const home = mkdtempSync(join(tmpdir(), "sharer-smoke-"));
const env = { ...process.env, COPILOT_HOME: home };
const copilot = (...args) => execFileSync("copilot", args, { env, encoding: "utf8", shell: process.platform === "win32" });

try {
  copilot("--version");
} catch {
  console.error("smoke-install: the `copilot` CLI is not on PATH. Install it, then re-run (this step is local, not CI).");
  process.exit(2);
}

let failed = false;
try {
  console.log(copilot("plugin", "marketplace", "add", root));
  const plugins = listPlugins(root);
  if (!plugins.length) throw new Error("no plugins found in the marketplace");
  for (const p of plugins) console.log(copilot("plugin", "install", `${p.name}@${marketplace}`));
  const list = copilot("plugin", "list", "--json");
  for (const p of plugins) {
    if (!list.includes(p.name)) throw new Error(`${p.name} not in \`copilot plugin list --json\``);
    // Installed copy or live local-marketplace source, whichever this CLI version uses.
    const rel = `${p.extRel}/extension.mjs`;
    const candidates = [join(home, "installed-plugins", marketplace, p.name, rel), join(root, p.source, rel)];
    if (!candidates.some(existsSync)) throw new Error(`${p.name}: extension.mjs not found in: ${candidates.join(", ")}`);
  }
  console.log("smoke-install: ok");
} catch (e) {
  console.error(`smoke-install: FAILED: ${e.message}`);
  failed = true;
} finally {
  rmSync(home, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
