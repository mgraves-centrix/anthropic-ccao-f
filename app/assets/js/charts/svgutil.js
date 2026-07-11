// Tiny SVG helpers for the hand-rolled charts (spec §10). No dependencies.
export const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export const scale = (v, dMin, dMax, rMin, rMax) => {
  if (dMax === dMin) return (rMin + rMax) / 2;
  return rMin + ((v - dMin) / (dMax - dMin)) * (rMax - rMin);
};

/** Strength color by percent (matches semantic tokens; not an exam accent). */
export const strengthColor = (pct) =>
  pct >= 70 ? "var(--correct)" : pct >= 50 ? "var(--amber)" : "var(--wrong)";

export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Wrap chart body in a responsive, accessible <svg>. */
export const svg = (viewBox, ariaLabel, body) =>
  `<svg viewBox="${viewBox}" role="img" aria-label="${esc(ariaLabel)}" ` +
  `preserveAspectRatio="xMidYMid meet" class="chart-svg">${body}</svg>`;

export const emptyState = (msg) =>
  `<div class="chart-empty" role="img" aria-label="${esc(msg)}">${esc(msg)}</div>`;
