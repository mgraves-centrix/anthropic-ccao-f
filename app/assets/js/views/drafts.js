// Reviewer draft preview (spec nice-to-have). Reviewers/admins preview unpublished
// (draft) items — stem, options with the keyed answer marked, and rationale —
// before they are published. Gated by the reviewer/admin role at the API.
import { api } from "../api.js";
import { esc, safeHref } from "../util.js";

export async function renderDrafts(el) {
  document.body.removeAttribute("data-exam");
  let exams = [];
  try { exams = await api.catalog(); } catch { /* ignore */ }
  el.innerHTML =
    `<h1>Draft review</h1><p class="muted">Preview unpublished items before they go live.</p>` +
    `<div class="prog-controls"><label for="draftExam" class="mono">Exam</label> ` +
    `<select id="draftExam" class="switcher__sel">${exams.map((e) => `<option value="${esc(e.examId)}">${esc(e.examId)}</option>`).join("")}</select></div>` +
    `<div id="draftList"><p class="loading">Select an exam…</p></div>`;
  const sel = el.querySelector("#draftExam");
  const list = el.querySelector("#draftList");
  const load = async () => {
    list.innerHTML = `<p class="loading">Loading drafts…</p>`;
    let drafts = [];
    try { drafts = await api.drafts(sel.value); }
    catch (e) { list.innerHTML = `<div class="card"><p>${esc(e.message)}</p></div>`; return; }
    if (!drafts.length) { list.innerHTML = `<div class="chart-empty">No draft items for this exam.</div>`; return; }
    list.innerHTML = drafts.map(draftCard).join("");
  };
  if (exams.length) { load(); sel.addEventListener("change", load); }
}

function draftCard(q) {
  const opts = q.options.map((o, i) =>
    `<li class="${q.correct.includes(i) ? "opt correct" : "opt"}">${esc(o)}${q.correct.includes(i) ? " ✓" : ""}</li>`).join("");
  return `<div class="card"><p class="mono muted">${esc(q.questionId)} · domain ${q.domain} · ${esc(q.type)}${q.scenarioId ? " · " + esc(q.scenarioId) : ""} · <span class="rationale__verdict wrong">DRAFT</span></p>` +
    `<p class="qstem">${esc(q.stem)}</p><ul class="opts">${opts}</ul>` +
    `<div class="rationale right"><strong>Rationale.</strong> ${esc(q.rationale)}` +
    (q.referenceUrl ? ` <a href="${esc(safeHref(q.referenceUrl))}" target="_blank" rel="noreferrer">${esc(q.referenceText || "reference")}</a>` : "") + `</div></div>`;
}
