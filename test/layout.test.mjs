import { test } from "node:test";
import assert from "node:assert/strict";
import { LIST, NARROW_BREAKPOINT, clamp, clampListWidth, isNarrow, nextWidthFromKey, ariaValues } from "../plugins/release-sharer/com.github.copilot/extensions/release-sharer/lib/layout.mjs";

test("constants match the design", () => {
  assert.deepEqual(LIST, { min: 220, default: 300, maxFraction: 0.6, detailMin: 360, keyStep: 16, keyStepFast: 48 });
  assert.equal(NARROW_BREAKPOINT, 640);
});

test("clamp edges", () => {
  assert.equal(clamp(5, 1, 10), 5);
  assert.equal(clamp(-1, 1, 10), 1);
  assert.equal(clamp(11, 1, 10), 10);
  assert.equal(clamp(1, 1, 10), 1);
  assert.equal(clamp(10, 1, 10), 10);
});

test("clampListWidth: bounds are [220, max(220, min(cw*0.6, cw-360))]", () => {
  assert.equal(clampListWidth(300, 1000), 300);
  assert.equal(clampListWidth(100, 1000), 220);
  assert.equal(clampListWidth(900, 1000), 600); // 60% of 1000
  assert.equal(clampListWidth(900, 800), 440); // cw-360 is the tighter bound
  assert.equal(clampListWidth(900, 2000), 900);
  assert.equal(clampListWidth(1500, 2000), 1200);
  assert.equal(clampListWidth(250.4, 1000), 250);
});

test("clampListWidth: container narrower than min returns min", () => {
  for (const cw of [0, 100, 219, 500, 580]) assert.equal(clampListWidth(300, cw), 220, String(cw));
  assert.equal(clampListWidth(1000, 580), 220);
});

test("NaN, negative and non-numeric input fall back to the default", () => {
  for (const bad of [NaN, -5, undefined, null, "300", Infinity]) assert.equal(clampListWidth(bad, 1000), 300, String(bad));
  assert.equal(clampListWidth(300, NaN), 220);
  assert.equal(clampListWidth(300, -10), 220);
});

test("isNarrow: strictly below 640", () => {
  assert.equal(isNarrow(639), true);
  assert.equal(isNarrow(640), false);
  assert.equal(isNarrow(1200), false);
  assert.equal(isNarrow(NaN), false);
  assert.equal(isNarrow(undefined), false);
});

test("nextWidthFromKey: arrows step 16, shift steps 48, clamped at the ends", () => {
  assert.equal(nextWidthFromKey("ArrowRight", 300, 1000, false), 316);
  assert.equal(nextWidthFromKey("ArrowLeft", 300, 1000, false), 284);
  assert.equal(nextWidthFromKey("ArrowRight", 300, 1000, true), 348);
  assert.equal(nextWidthFromKey("ArrowLeft", 300, 1000, true), 252);
  assert.equal(nextWidthFromKey("ArrowLeft", 225, 1000, false), 220);
  assert.equal(nextWidthFromKey("ArrowRight", 595, 1000, false), 600);
  assert.equal(nextWidthFromKey("ArrowLeft", 220, 1000), 220);
});

test("nextWidthFromKey: Home, End, other keys and bad input", () => {
  assert.equal(nextWidthFromKey("Home", 400, 1000), 220);
  assert.equal(nextWidthFromKey("End", 400, 1000), 600);
  assert.equal(nextWidthFromKey("End", 400, 800), 440);
  assert.equal(nextWidthFromKey("End", 400, 300), 220);
  assert.equal(nextWidthFromKey("Enter", 400, 1000), 400);
  assert.equal(nextWidthFromKey("a", 9999, 1000), 600);
  assert.equal(nextWidthFromKey("ArrowRight", NaN, 1000), 316);
});

test("ariaValues reports clamped now, min and max", () => {
  assert.deepEqual(ariaValues(300, 1000), { now: 300, min: 220, max: 600 });
  assert.deepEqual(ariaValues(900, 1000), { now: 600, min: 220, max: 600 });
  assert.deepEqual(ariaValues(300, 400), { now: 220, min: 220, max: 220 });
  assert.deepEqual(ariaValues(NaN, 1000), { now: 300, min: 220, max: 600 });
});
