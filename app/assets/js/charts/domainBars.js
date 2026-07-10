// Average-%-correct-by-domain bar chart (spec §10). Pure function → SVG string.
// Bars colored by strength (green≥70/amber≥50/red<50); grow-from-0 only when
// motion is allowed (final state always present → reduced-motion-safe).
import { esc, svg, emptyState, strengthColor, prefersReducedMotion } from "./svgutil.js";

const W = 720, ROW = 42, PAD_L = 160, PAD_R = 60, PAD_T = 16;

export function renderDomainBars(domains, opts = {}) {
  const animate = opts.animate ?? !prefersReducedMotion();
  if (!domains || domains.length === 0) {
    return emptyState(opts.emptyMessage || "No domain data in this window yet.");
  }
  const H = PAD_T * 2 + domains.length * ROW;
  const barMax = W - PAD_L - PAD_R;

  const label = "Average percent correct by domain: " +
    domains.map((d) => `${d.name} ${d.avgPct}%`).join(", ") + ".";

  const rows = domains.map((d, i) => {
    const y = PAD_T + i * ROW;
    const w = Math.max(0, Math.min(100, d.avgPct)) / 100 * barMax;
    const color = strengthColor(d.avgPct);
    const grow = animate
      ? `<animate attributeName="width" from="0" to="${w}" dur="0.5s" begin="${i * 0.08}s" fill="freeze"/>`
      : "";
    const barW = animate ? 0 : w;
    return (
      `<text x="${PAD_L - 10}" y="${y + ROW / 2}" text-anchor="end" dominant-baseline="middle" ` +
      `font-size="13" fill="var(--ink-2)">${esc(d.name)}</text>` +
      `<rect x="${PAD_L}" y="${y + 6}" width="${barMax}" height="${ROW - 18}" rx="4" fill="var(--surface-2)"/>` +
      `<rect x="${PAD_L}" y="${y + 6}" width="${barW}" height="${ROW - 18}" rx="4" fill="${color}">${grow}</rect>` +
      `<text x="${PAD_L + barMax + 8}" y="${y + ROW / 2}" dominant-baseline="middle" ` +
      `font-size="12" font-family="var(--font-mono)" fill="var(--muted)">${d.avgPct}%</text>`
    );
  }).join("");

  return svg(`0 0 ${W} ${H}`, label, rows);
}
