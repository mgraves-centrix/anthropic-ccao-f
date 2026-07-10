// Per-exam workspace with all four tabs (spec §III.8). Applies the exam accent
// via body[data-exam]; the global switcher lets users move between exams.
import { api } from "../api.js";
import { go } from "../router.js";
import { renderProgress } from "./progress.js";
import { renderRunner } from "./runner.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const TABS = [["home", "Home"], ["practice", "Practice"], ["mock", "Mock"], ["study", "Study"], ["progress", "Progress"]];
let catalogCache = null;

async function catalog() { return (catalogCache ??= await api.catalog()); }

export async function renderExam(el, route) {
  const { examId, tab } = route;
  const exams = await catalog();
  const exam = exams.find((e) => e.examId === examId);
  document.body.dataset.exam = examId;
  fillSwitcher(exams, examId);
  if (!exam) { el.innerHTML = `<div class="card"><p>Unknown exam.</p></div>`; return; }

  el.innerHTML =
    `<div class="examhead"><span class="pill">${esc(exam.examId)}</span><h1>${esc(exam.name)}</h1></div>` +
    `<nav class="tabs" aria-label="Exam sections">` +
    TABS.map(([id, label]) =>
      `<a class="tab${tab === id ? " is-active" : ""}" href="#/exam/${encodeURIComponent(examId)}/${id}"${tab === id ? ' aria-current="page"' : ""}>${label}</a>`
    ).join("") + `</nav><div id="tabbody" class="tabbody"></div>`;

  const body = el.querySelector("#tabbody");
  if (tab === "practice") return renderRunner(body, { examId, mode: "practice" });
  if (tab === "mock") return renderRunner(body, { examId, mode: "mock" });
  if (tab === "progress") return renderProgress(body, examId);
  if (tab === "study") return renderStudy(body, exam);
  return renderHome(body, exam);
}

async function renderHome(body, exam) {
  const hist = await api.history("exam", exam.examId, 30).catch(() => null);
  const latest = hist?.points?.length ? hist.points[hist.points.length - 1] : null;
  body.innerHTML =
    `<div class="card"><h3>Readiness</h3>` +
    (latest
      ? `<p class="calib">Last score <strong>${latest.scaled}</strong> / 1000 — ${latest.pass ? "at or above" : "below"} the ${exam.cutScore} cut.</p>`
      : `<p class="muted">No attempts yet. Take a practice set to calibrate.</p>`) +
    `<p><button class="btn btn--primary" data-go="practice">Start practice</button> ` +
    `<button class="btn" data-go="mock">Take timed mock (${exam.timeLimitMin} min)</button></p></div>` +
    `<div class="card"><h3>Blueprint</h3><ul class="weights">` +
    exam.domains.map((d) => `<li><span>${esc(d.name)}</span> <span class="mono">${d.weight}%</span></li>`).join("") +
    `</ul></div>`;
  body.querySelectorAll("[data-go]").forEach((b) =>
    b.addEventListener("click", () => go(`#/exam/${encodeURIComponent(exam.examId)}/${b.dataset.go}`)));
}

function renderStudy(body, exam) {
  body.innerHTML =
    `<div class="card"><h3>Study guide</h3>` +
    `<p class="muted">Reference-grounded notes per domain. Content is authored per exam ` +
    `(CCAO-F migrated; others in progress).</p><ul class="weights">` +
    exam.domains.map((d) => `<li id="study-domain-${d.id}"><span>${esc(d.name)}</span> <span class="mono">${d.weight}%</span></li>`).join("") +
    `</ul></div>`;
}

function fillSwitcher(exams, current) {
  const sw = document.getElementById("examSwitcher");
  if (!sw) return;
  sw.hidden = false;
  sw.innerHTML =
    `<label class="visually-hidden" for="examSel">Switch exam</label>` +
    `<select id="examSel" class="switcher__sel">` +
    exams.map((e) => `<option value="${e.examId}"${e.examId === current ? " selected" : ""}>${e.examId}</option>`).join("") +
    `</select>`;
  const sel = sw.querySelector("#examSel");
  sel.addEventListener("change", () => go(`#/exam/${encodeURIComponent(sel.value)}/home`));
}
