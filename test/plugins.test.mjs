import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listPlugins } from "../scripts/plugins.mjs";
import { checkExtensions } from "../scripts/check-extensions.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));

test("listPlugins returns both marketplace plugins with their paths", () => {
  const plugins = listPlugins(repo);
  assert.deepEqual(plugins.map((p) => p.name), ["release-sharer", "activity-sharer"]);
  const [rs, as] = plugins;
  assert.equal(rs.entry, "plugins/release-sharer/com.github.copilot/extensions/release-sharer/extension.mjs");
  assert.equal(rs.changelogRel, "CHANGELOG.md");
  assert.equal(as.entry, "plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/extension.mjs");
  assert.equal(as.extRel, "com.github.copilot/extensions/activity-sharer");
  assert.equal(as.changelogRel, "plugins/activity-sharer/CHANGELOG.md");
});

test("listPlugins returns [] when the marketplace file is missing or broken", () => {
  const dir = mkdtempSync(join(tmpdir(), "plugins-"));
  try {
    assert.deepEqual(listPlugins(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkExtensions passes for the repo and reports a syntax error in any plugin", () => {
  assert.deepEqual(checkExtensions(repo), []);
  const dir = mkdtempSync(join(tmpdir(), "extensions-"));
  try {
    cpSync(join(repo, "plugins"), join(dir, "plugins"), { recursive: true });
    cpSync(join(repo, ".github"), join(dir, ".github"), { recursive: true });
    const f = join(dir, "plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/extension.mjs");
    writeFileSync(f, readFileSync(f, "utf8") + "\nconst = ;\n");
    const errors = checkExtensions(dir);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /activity-sharer\/extension\.mjs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
