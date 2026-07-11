// Progress dashboard (spec §10): score-history line + domain bars, 7/30 toggle,
// exam vs all-exams scope. Reads ONLY the user's own aggregates.
import { api } from "../api.js";
import { renderScoreHistory } from "../charts/scoreHistory.js";
import { renderDomainBars } from "../charts/domainBars.js";

const state = { window: 7, scope: "exam" };

export async function renderProgress(host, examId) {
  const data = await api.history(state.scope, examId, state.window).catch(() => null);
  const cut = data?.cutScore ?? 720;
  const controls =
    `<div class="prog-controls">` +
    [7, 30].map((w) => `<button class="chip${state.window === w ? " is-on" : ""}" data-window="${w}">Last ${w} days</button>`).join("") +
    `<span class="sep"></span>` +
    ["exam", "all"].map((s) => `<button class="chip${state.scope === s ? " is-on" : ""}" data-scope="${s}">${s === "exam" ? "This exam" : "All exams"}</button>`).join("") +
    `</div>`;

  const line = renderScoreHistory(data?.points ?? [], { cut });
  const bars = data && state.scope === "exam"
    ? renderDomainBars((data.byDomain ?? []).map((d) => ({ id: d.id, name: d.name, avgPct: d.avgPct })))
    : renderDomainBars((data?.byExam ?? []).map((e) => ({ id: e.examId, name: e.examId, avgPct: Math.round((e.avgScaled - 100) / 9) })),
      { emptyMessage: "No attempts across exams in this window yet." });

  host.innerHTML =
    controls +
    `<div class="card"><h3>Score history</h3>${line}</div>` +
    `<div class="card"><h3>${state.scope === "exam" ? "Average % correct by domain" : "Average score by exam"}</h3>${bars}</div>` +
    `<p><button class="btn" id="exportCsv">Export my results (CSV)</button></p>`;

  host.querySelectorAll("[data-window]").forEach((b) =>
    b.addEventListener("click", () => { state.window = Number(b.dataset.window); renderProgress(host, examId); }));
  host.querySelectorAll("[data-scope]").forEach((b) =>
    b.addEventListener("click", () => { state.scope = b.dataset.scope; renderProgress(host, examId); }));
  const exp = host.querySelector("#exportCsv");
  if (exp) exp.addEventListener("click", () => exportCsv(data?.points ?? [], examId));
}

/** Self-service export of the user's OWN results (spec nice-to-have). */
function exportCsv(points, examId) {
  const rows = [["date", "exam", "scaled", "pass"], ...points.map((p) => [p.date, p.examId || examId, p.scaled, p.pass])];
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `results-${examId || "all"}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
