// Pure layout maths for the resizable split. No DOM or Node imports.

export const LIST = { min: 220, default: 300, maxFraction: 0.6, detailMin: 360, keyStep: 16, keyStepFast: 48 };
export const NARROW_BREAKPOINT = 640;

export function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

function validNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

/** Upper bound for the list column: at most 60% of the container, always leaving detailMin, never below min. */
function maxListWidth(containerWidth) {
  const cw = validNumber(containerWidth) && containerWidth > 0 ? containerWidth : 0;
  return Math.max(LIST.min, Math.min(cw * LIST.maxFraction, cw - LIST.detailMin));
}

/** Clamps a list width to [min, max]. NaN or negative input falls back to the default. */
export function clampListWidth(px, containerWidth) {
  const wanted = validNumber(px) && px >= 0 ? px : LIST.default;
  return Math.round(clamp(wanted, LIST.min, maxListWidth(containerWidth)));
}

export function isNarrow(containerWidth) {
  return validNumber(containerWidth) && containerWidth < NARROW_BREAKPOINT;
}

/** Width after a key press on the splitter. Unhandled keys return the (clamped) current width. */
export function nextWidthFromKey(key, current, containerWidth, shift = false) {
  const step = shift ? LIST.keyStepFast : LIST.keyStep;
  const max = maxListWidth(containerWidth);
  switch (key) {
    case "ArrowLeft": return clampListWidth(clampListWidth(current, containerWidth) - step, containerWidth);
    case "ArrowRight": return clampListWidth(clampListWidth(current, containerWidth) + step, containerWidth);
    case "Home": return LIST.min;
    case "End": return Math.round(max);
    default: return clampListWidth(current, containerWidth);
  }
}

/** Values for aria-valuenow / aria-valuemin / aria-valuemax on the separator. */
export function ariaValues(current, containerWidth) {
  return { now: clampListWidth(current, containerWidth), min: LIST.min, max: Math.round(maxListWidth(containerWidth)) };
}
