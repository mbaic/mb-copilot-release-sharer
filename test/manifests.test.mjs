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
    writeFileSync(f, readFileSync(f, "utf8").replace('"version": "0.1.0" }', '"version": "0.2.0" }'));
    assert.match(checkManifests(dir).join("\n"), /versions differ/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing preview image is reported", () => {
  const dir = copyRepoManifests();
  try {
    rmSync(join(dir, "plugins/release-sharer/com.github.copilot/extensions/release-sharer/assets/preview.png"));
    assert.match(checkManifests(dir).join("\n"), /preview\.png is missing/);
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
