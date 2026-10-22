import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkManifests } from "../scripts/check-manifests.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));

function copyRepoManifests() {
  const dir = mkdtempSync(join(tmpdir(), "manifests-"));
  for (const p of ["plugins", ".github", "CHANGELOG.md"]) cpSync(join(repo, p), join(dir, p), { recursive: true });
  return dir;
}

test("the repo's own manifests pass", () => {
  assert.deepEqual(checkManifests(repo), []);
});

test("a version mismatch is reported", () => {
  const dir = copyRepoManifests();
  try {
    const f = join(dir, ".github/plugin/marketplace.json");
    const m = JSON.parse(readFileSync(f, "utf8"));
    m.plugins[0].version = "0.9.9";
    writeFileSync(f, JSON.stringify(m));
    assert.match(checkManifests(dir).join("\n"), /plugin release-sharer: versions differ/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a skill whose name does not match its folder is reported", () => {
  const dir = copyRepoManifests();
  try {
    const f = join(dir, "plugins/release-sharer/skills/mb-release-sharer/SKILL.md");
    writeFileSync(f, readFileSync(f, "utf8").replace("name: mb-release-sharer", "name: other"));
    assert.match(checkManifests(dir).join("\n"), /frontmatter name must be 'mb-release-sharer'/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing preview image is reported", () => {
  const dir = copyRepoManifests();
  try {
    rmSync(join(dir, "plugins/release-sharer/com.github.copilot/extensions/release-sharer/assets/preview.png"));
    assert.match(checkManifests(dir).join("\n"), /plugin release-sharer: .*preview\.png is missing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a wrong source path is reported", () => {
  const dir = copyRepoManifests();
  try {
    const f = join(dir, ".github/plugin/marketplace.json");
    writeFileSync(f, readFileSync(f, "utf8").replace("plugins/release-sharer", "plugins/nope"));
    assert.match(checkManifests(dir).join("\n"), /no plugin\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every marketplace plugin is checked: a drift in activity-sharer is reported", () => {
  const dir = copyRepoManifests();
  try {
    const f = join(dir, "plugins/activity-sharer/CHANGELOG.md");
    writeFileSync(f, readFileSync(f, "utf8").replace("## 0.2.2", "## 0.9.9"));
    const out = checkManifests(dir).join("\n");
    assert.match(out, /plugin activity-sharer: versions differ/);
    assert.doesNotMatch(out, /plugin release-sharer/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a plugin whose skill frontmatter name differs from its folder is reported per plugin", () => {
  const dir = copyRepoManifests();
  try {
    const f = join(dir, "plugins/activity-sharer/skills/mb-activity-sharer/SKILL.md");
    writeFileSync(f, readFileSync(f, "utf8").replace("name: mb-activity-sharer", "name: other"));
    assert.match(checkManifests(dir).join("\n"), /plugin activity-sharer: skills\/mb-activity-sharer: frontmatter name/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing marketplace metadata version and a duplicate plugin name are reported", () => {
  const dir = copyRepoManifests();
  try {
    const f = join(dir, ".github/plugin/marketplace.json");
    const m = JSON.parse(readFileSync(f, "utf8"));
    delete m.metadata.version;
    m.plugins.push({ ...m.plugins[0] });
    writeFileSync(f, JSON.stringify(m));
    const out = checkManifests(dir).join("\n");
    assert.match(out, /metadata\.version must be x\.y\.z/);
    assert.match(out, /duplicate plugin names/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a runtime dependency in a plugin's package.json is reported", () => {
  const dir = copyRepoManifests();
  try {
    const f = join(dir, "plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/package.json");
    const pkg = JSON.parse(readFileSync(f, "utf8"));
    pkg.dependencies = { "left-pad": "1.0.0" };
    writeFileSync(f, JSON.stringify(pkg));
    assert.match(checkManifests(dir).join("\n"), /plugin activity-sharer: .*no runtime dependencies/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
