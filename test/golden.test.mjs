import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildModel } from "../plugins/release-sharer/com.github.copilot/extensions/release-sharer/lib/model.mjs";
import { format } from "../plugins/release-sharer/com.github.copilot/extensions/release-sharer/lib/formatters.mjs";
import { fixture, toRelease } from "./helpers.mjs";

// 4 formats x clean on/off, contributors and link on. Set UPDATE_GOLDEN=1 to rewrite the files, then review the diff.
const model = buildModel(toRelease(fixture("v2.4.1.release.json")));
const path = (name) => fileURLToPath(new URL(`./golden/${name}`, import.meta.url));

const cases = [
  ["plain", "txt"],
  ["markdown", "txt"],
  ["email", "txt"],
  ["html", "html"],
];

for (const [kind, ext] of cases) {
  for (const clean of [true, false]) {
    test(`golden: ${kind} clean ${clean ? "on" : "off"}`, () => {
      const out = format(model, { format: kind, clean, contributors: true, link: true, repoLabel: "acme/bc-app" });
      const actual = kind === "email" ? `Subject: ${out.subject}\n\n${out.body}` : kind === "html" ? out.html : out.body;
      const file = path(`${kind}.${clean ? "clean" : "raw"}.${ext}`);
      if (process.env.UPDATE_GOLDEN) writeFileSync(file, actual);
      assert.equal(actual, readFileSync(file, "utf8"));
    });
  }
}

test("html: text/plain companion is the Plain output", () => {
  const out = format(model, { format: "html", repoLabel: "acme/bc-app" });
  assert.equal(out.body, format(model, { format: "plain" }).body);
});
