// Resizable list/detail split (PLAN 11.4). The maths lives in lib/layout.mjs.
import { LIST, ariaValues, clampListWidth, isNarrow, nextWidthFromKey } from "../lib/layout.mjs";

/**
 * @param {object} o
 * @param {HTMLElement} o.container  grid element; receives the --list-w variable and data-narrow / data-collapsed
 * @param {HTMLElement} o.handle     the role="separator" element
 * @param {HTMLButtonElement} o.chevron  collapse / expand button
 * @param {number} o.width           preferred list width
 * @param {boolean} o.collapsed
 * @param {(mode:{narrow:boolean, collapsed:boolean}) => void} o.onMode  called when narrow/collapsed changes
 * @param {(patch:{listWidth?:number, listCollapsed?:boolean}) => void} o.onSave
 */
export function initSplitter(o) {
  const { container, handle, chevron } = o;
  let preferred = o.width;
  let collapsed = Boolean(o.collapsed);
  let narrow = false;
  let raf = 0;

  const containerWidth = () => container.getBoundingClientRect().width;

  function paint() {
    const cw = containerWidth();
    const v = ariaValues(preferred, cw);
    container.style.setProperty("--list-w", `${v.now}px`);
    handle.setAttribute("aria-valuenow", String(v.now));
    handle.setAttribute("aria-valuemin", String(v.min));
    handle.setAttribute("aria-valuemax", String(v.max));
    return v.now;
  }

  function mode() {
    container.dataset.narrow = String(narrow);
    container.dataset.collapsed = String(collapsed);
    chevron.setAttribute("aria-expanded", String(!collapsed));
    chevron.setAttribute("aria-label", collapsed ? "Show release list" : "Collapse release list");
    chevron.dataset.dir = collapsed ? "right" : "left";
    o.onMode({ narrow, collapsed });
  }

  function setWidth(px, save) {
    preferred = clampListWidth(px, containerWidth());
    paint();
    if (save) o.onSave({ listWidth: preferred });
  }

  // Drag
  let drag = null;
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || narrow || collapsed) return;
    handle.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, w: paint() };
    document.body.classList.add("dragging");
    e.preventDefault();
  });
  handle.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const next = drag.w + e.clientX - drag.x;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => setWidth(next, false));
  });
  const endDrag = (e) => {
    if (!drag) return;
    const final = drag.w + e.clientX - drag.x;
    drag = null;
    cancelAnimationFrame(raf);
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    document.body.classList.remove("dragging");
    setWidth(final, true);
  };
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);

  // Keyboard and reset
  const reset = () => setWidth(LIST.default, true);
  handle.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); reset(); return; }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    setWidth(nextWidthFromKey(e.key, preferred, containerWidth(), e.shiftKey), true);
  });
  handle.addEventListener("dblclick", reset);

  function setCollapsed(value, save = true) {
    collapsed = value;
    mode();
    if (save) o.onSave({ listCollapsed: collapsed });
  }
  chevron.addEventListener("click", () => setCollapsed(!collapsed));

  // Re-clamp and switch narrow mode whenever the container resizes; saved prefs stay untouched.
  const ro = new ResizeObserver(() => {
    const n = isNarrow(containerWidth());
    paint();
    if (n !== narrow) { narrow = n; mode(); }
  });
  ro.observe(container);

  narrow = isNarrow(containerWidth());
  paint();
  mode();

  return { setCollapsed, setWidth, destroy: () => ro.disconnect() };
}
