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

async function renderStudy(body, exam) {
  body.innerHTML = `<div class="card"><p class="loading">Loading study guide…</p></div>`;
  let guide = null;
  try { guide = await api.study(exam.examId); } catch { /* none yet */ }
  if (!guide || !guide.sections) {
    body.innerHTML =
      `<div class="card"><h3>Study guide</h3><p class="muted">Reference-grounded notes per domain — authored per exam.</p>` +
      `<ul class="weights">` + exam.domains.map((d) =>
        `<li id="study-domain-${d.id}"><span>${esc(d.name)}</span><span class="mono">${d.weight}%</span></li>`).join("") +
      `</ul></div>`;
    return;
  }
  body.innerHTML =
    (guide.title ? `<h2>${esc(guide.title)}</h2>` : "") +
    (guide.subtitle ? `<p class="muted">${esc(guide.subtitle)}</p>` : "") +
    guide.sections.map(renderSection).join("");
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

function renderSection(sec) {
  const head = `<h3>${esc(sec.label || sec.id || "")}</h3>`;
  if (sec.kind === "facts" && Array.isArray(sec.items)) {
    return `<div class="card">${head}<table class="facts">` +
      sec.items.map((row) => `<tr><td>${esc(row[0])}</td><td>${esc(row[1])}</td></tr>`).join("") +
      `</table></div>`;
  }
  if (sec.kind === "prose" && Array.isArray(sec.body)) {
    return `<div class="card">${head}${sec.body.map((p) => `<p>${esc(p)}</p>`).join("")}</div>`;
  }
  // generic: domain notes with links/courses if present
  const links = Array.isArray(sec.links)
    ? `<ul>${sec.links.map((l) => `<li><a href="${esc(l.url || l[1] || "#")}" target="_blank" rel="noreferrer">${esc(l.label || l[0] || l.url)}</a></li>`).join("")}</ul>` : "";
  const notes = Array.isArray(sec.body) ? sec.body.map((p) => `<p>${esc(p)}</p>`).join("")
    : sec.body ? `<p>${esc(sec.body)}</p>` : "";
  const items = Array.isArray(sec.items) && !sec.kind
    ? `<ul>${sec.items.map((it) => `<li>${esc(typeof it === "string" ? it : (it.text || it.name || JSON.stringify(it)))}</li>`).join("")}</ul>` : "";
  return `<div class="card">${head}${notes}${items}${links}</div>`;
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
