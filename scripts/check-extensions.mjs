// Syntax-checks (node --check) the entry file of every marketplace plugin.
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listPlugins } from "./plugins.mjs";

/** Returns problem strings; empty means every extension entry parses. */
export function checkExtensions(root) {
  const plugins = listPlugins(root);
  if (!plugins.length) return ["no plugins found in .github/plugin/marketplace.json"];
  const errors = [];
  for (const p of plugins) {
    try {
      execFileSync(process.execPath, ["--check", join(root, p.entry)], { stdio: "pipe" });
    } catch (e) {
      errors.push(`${p.entry}: ${String(e.stderr ?? e.message).split("\n").find(Boolean) ?? "syntax error"}`);
    }
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const errors = checkExtensions(root);
  if (errors.length) {
    for (const e of errors) console.error(`check-extensions: ${e}`);
    process.exit(1);
  }
  console.log("check-extensions: ok");
}
