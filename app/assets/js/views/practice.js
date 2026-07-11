// Configurable practice setup (spec nice-to-haves): choose mode (all / weak /
// retry-incorrect / bookmarked), question count, and domains before starting.
import { renderRunner } from "./runner.js";
import { esc } from "../util.js";

const MODES = [
  ["all", "All questions", "Draw from the whole bank, blueprint-weighted."],
  ["weak", "Weak areas", "Focus on questions you've missed or haven't mastered (spaced repetition)."],
  ["incorrect", "Retry incorrect", "Only questions you got wrong in past attempts."],
  ["bookmarked", "Bookmarked", "Only questions you've bookmarked."],
];

export function renderPractice(host, exam) {
  host.innerHTML =
    `<div class="card"><h3>Configure practice</h3>` +
    `<fieldset class="pconf"><legend>Mode</legend>` +
    MODES.map(([v, label, help], i) =>
      `<label class="pradio"><input type="radio" name="pmode" value="${v}"${i === 0 ? " checked" : ""}> ` +
      `<span><strong>${esc(label)}</strong><br><span class="muted">${esc(help)}</span></span></label>`).join("") +
    `</fieldset>` +
    `<div class="pconf__row"><label for="pcount">Questions</label> ` +
    `<input id="pcount" type="number" min="1" max="60" value="10" class="pnum"></div>` +
    `<fieldset class="pconf"><legend>Domains (optional)</legend>` +
    exam.domains.map((d) => `<label class="pcheck"><input type="checkbox" name="pdom" value="${d.id}"> ${esc(d.name)} <span class="mono muted">${d.weight}%</span></label>`).join("") +
    `</fieldset>` +
    `<p><button class="btn btn--primary" id="pstart">Start practice</button></p></div>`;

  host.querySelector("#pstart").addEventListener("click", () => {
    const source = host.querySelector('input[name="pmode"]:checked').value;
    const count = Math.max(1, Math.min(60, Number(host.querySelector("#pcount").value) || 10));
    const domains = [...host.querySelectorAll('input[name="pdom"]:checked')].map((c) => Number(c.value));
    const filters = { count, ...(source !== "all" ? { source } : {}), ...(domains.length ? { domains } : {}) };
    renderRunner(host, { examId: exam.examId, mode: "practice", filters });
  });
}
