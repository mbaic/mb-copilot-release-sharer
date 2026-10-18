// Install smoke test (PLAN section 16): isolated COPILOT_HOME, add this repo as a marketplace,
// install the plugin, assert it is listed and the extension entry exists. Needs the `copilot` CLI on PATH.
// Local step before every release; run with: npm run smoke
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const home = mkdtempSync(join(tmpdir(), "release-sharer-smoke-"));
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
  console.log(copilot("plugin", "install", "release-sharer@release-sharer"));
  const list = copilot("plugin", "list", "--json");
  if (!list.includes("release-sharer")) throw new Error("release-sharer not in `copilot plugin list --json`");
  // Installed copy or live local-marketplace source, whichever this CLI version uses (PLAN section 3.1).
  const rel = "com.github.copilot/extensions/release-sharer/extension.mjs";
  const candidates = [join(home, "installed-plugins/release-sharer/release-sharer", rel), join(root, "plugins/release-sharer", rel)];
  if (!candidates.some(existsSync)) throw new Error(`extension.mjs not found in: ${candidates.join(", ")}`);
  console.log("smoke-install: ok");
} catch (e) {
  console.error(`smoke-install: FAILED: ${e.message}`);
  failed = true;
} finally {
  rmSync(home, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
