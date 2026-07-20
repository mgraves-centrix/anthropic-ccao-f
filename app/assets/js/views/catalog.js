// Landing: the 4-exam picker with per-exam accent identity (spec §III.8).
import { api } from "../api.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export async function renderCatalog(el) {
  const exams = await api.catalog();
  el.innerHTML =
    `<h1>Certification exams</h1><p class="muted">Pick an exam to open its workspace.</p>` +
    `<div class="examgrid">` +
    exams.map((e) => (
      `<a class="examcard" href="#/exam/${encodeURIComponent(e.examId)}/home" data-exam="${esc(e.examId)}">` +
      `<span class="pill">${esc(e.examId)}</span>` +
      `<h2>${esc(e.name)}</h2>` +
      `<p class="mono">${e.itemCount} items · ${e.timeLimitMin} min · cut ${e.cutScore}` +
      (e.format === "scenario" ? " · scenario-based" : "") + `</p>` +
      `<p class="muted">${e.domains.length} domains · ${e.status === "live" ? "ready" : "in authoring"}</p>` +
      `</a>`
    )).join("") +
    `</div>`;
}
