// Score-history line chart (spec §10). Pure function → SVG string, so it is
// unit-testable and reduced-motion-safe (final state always rendered; <animate>
// only added when motion is allowed). X = dated attempts, Y = 100–1000, cut line,
// points colored pass/fail, line in the exam accent.
import { esc, scale, svg, emptyState, prefersReducedMotion } from "./svgutil.js";

const W = 720, H = 300, PAD = 40;

export function renderScoreHistory(points, opts = {}) {
  const cut = opts.cut ?? 720;
  const yMin = opts.min ?? 100, yMax = opts.max ?? 1000;
  const animate = opts.animate ?? !prefersReducedMotion();
  const accent = "var(--accent)";

  if (!points || points.length === 0) {
    return emptyState(opts.emptyMessage || "No attempts in this window yet — take a practice set.");
  }

  const n = points.length;
  const x = (i) => (n === 1 ? W / 2 : scale(i, 0, n - 1, PAD, W - PAD));
  const y = (v) => scale(v, yMin, yMax, H - PAD, PAD);

  const cutY = y(cut);
  const passed = points.filter((p) => p.pass).length;
  const label =
    `Score history: ${n} attempt${n > 1 ? "s" : ""}, ${passed} at or above the ${cut} cut. ` +
    `Latest ${points[n - 1].scaled}.`;

  const gridline = `<line x1="${PAD}" y1="${cutY}" x2="${W - PAD}" y2="${cutY}" ` +
    `stroke="var(--line-strong)" stroke-dasharray="4 4" stroke-width="1.5"/>` +
    `<text x="${W - PAD}" y="${cutY - 6}" text-anchor="end" font-size="12" ` +
    `fill="var(--muted)" font-family="var(--font-mono)">${cut} · pass</text>`;

  const linePts = points.map((p, i) => `${x(i)},${y(p.scaled)}`).join(" ");
  const path = `<polyline points="${linePts}" fill="none" stroke="${accent}" ` +
    `stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"` +
    (animate ? ` stroke-dasharray="2000" stroke-dashoffset="2000">` +
      `<animate attributeName="stroke-dashoffset" from="2000" to="0" dur="0.7s" fill="freeze"/></polyline>`
      : `/>`);

  const dots = points.map((p, i) => {
    const c = p.pass ? "var(--correct)" : "var(--wrong)";
    const cx = x(i), cy = y(p.scaled);
    const anim = animate
      ? `<animate attributeName="r" from="0" to="4.5" dur="0.25s" begin="${0.3 + i * 0.06}s" fill="freeze"/>`
      : "";
    const r = animate ? 0 : 4.5;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}" stroke="var(--surface)" stroke-width="1.5">` +
      `<title>${esc(p.date)}: ${p.scaled}${p.pass ? " (pass)" : ""}</title>${anim}</circle>`;
  }).join("");

  const axis = `<text x="${PAD}" y="${H - 12}" font-size="11" fill="var(--muted)">${yMin}</text>` +
    `<text x="${PAD}" y="${PAD - 8}" font-size="11" fill="var(--muted)">${yMax}</text>`;

  return svg(`0 0 ${W} ${H}`, label, gridline + path + dots + axis);
}
