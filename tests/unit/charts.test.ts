import { describe, it, expect } from "vitest";
// @ts-expect-error — importing the app's plain-JS chart modules
import { renderScoreHistory } from "../../app/assets/js/charts/scoreHistory.js";
// @ts-expect-error — plain JS
import { renderDomainBars } from "../../app/assets/js/charts/domainBars.js";

describe("scoreHistory chart (hand-rolled SVG)", () => {
  const pts = [
    { date: "2026-07-08", scaled: 690, pass: false },
    { date: "2026-07-09", scaled: 780, pass: true },
  ];
  it("empty window → accessible empty state", () => {
    const out = renderScoreHistory([], { animate: false });
    expect(out).toContain("chart-empty");
    expect(out).toContain("aria-label");
  });
  it("renders cut line, accent polyline, pass/fail points, role=img", () => {
    const out = renderScoreHistory(pts, { cut: 720, animate: false });
    expect(out).toContain('role="img"');
    expect(out).toContain("720 · pass");
    expect(out).toContain("<polyline");
    expect(out).toContain("var(--accent)");
    expect(out).toContain("var(--correct)"); // pass point
    expect(out).toContain("var(--wrong)"); // fail point
  });
  it("reduced-motion (animate:false) → final state, no <animate>", () => {
    const out = renderScoreHistory(pts, { animate: false });
    expect(out).not.toContain("<animate");
    expect(out).toContain('r="4.5"'); // points at final radius, not 0
  });
});

describe("domainBars chart", () => {
  const domains = [
    { id: 1, name: "Alpha", avgPct: 82 },
    { id: 2, name: "Beta", avgPct: 55 },
    { id: 3, name: "Gamma", avgPct: 30 },
  ];
  it("empty → empty state", () => {
    expect(renderDomainBars([], { animate: false })).toContain("chart-empty");
  });
  it("colors bars by strength; final width when reduced-motion", () => {
    const out = renderDomainBars(domains, { animate: false });
    expect(out).toContain("var(--correct)"); // 82% ≥70
    expect(out).toContain("var(--amber)"); // 55% ≥50
    expect(out).toContain("var(--wrong)"); // 30% <50
    expect(out).not.toContain("<animate");
    expect(out).toContain("82%");
  });
});
