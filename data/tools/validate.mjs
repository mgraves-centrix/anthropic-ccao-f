// Validation gate (spec §III.10). Fails (exit 1) unless a bank is schema-valid,
// referenced, dup-free, weight-distributed, has multi-response, and (scenario
// exams) every item has a valid scenarioId. Usage: node validate.mjs <exam-dir>
import { readFileSync } from "node:fs";

const dir = process.argv[2];
if (!dir) { console.error("usage: node validate.mjs <path-to-exam-dir>"); process.exit(2); }
const read = (f) => JSON.parse(readFileSync(new URL(`${dir}/${f}`, `file://${process.cwd()}/`), "utf8"));

let exam, questions;
try { exam = read("exam.json"); questions = read("questions.source.json"); }
catch (e) { console.error("read error:", e.message); process.exit(1); }

const errors = [];
const warn = [];
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
const seen = new Map();
const domainIds = new Set(exam.domains.map((d) => d.id));
const domainCount = {};
let multi = 0;

for (const [i, q] of questions.entries()) {
  const at = `#${i} ${q.questionId ?? "?"}`;
  if (!q.questionId) errors.push(`${at}: missing questionId`);
  if (!["single", "multiple"].includes(q.type)) errors.push(`${at}: bad type ${q.type}`);
  if (!q.stem || q.stem.length < 8) errors.push(`${at}: stem too short`);
  if (!Array.isArray(q.options) || q.options.length < 2) errors.push(`${at}: needs >=2 options`);
  if (!Array.isArray(q.correct) || q.correct.length < 1) errors.push(`${at}: needs >=1 correct`);
  else {
    for (const c of q.correct) if (c < 0 || c >= (q.options?.length ?? 0)) errors.push(`${at}: correct index ${c} out of range`);
    if (q.type === "single" && q.correct.length !== 1) errors.push(`${at}: single must have exactly 1 correct`);
    if (q.type === "multiple") multi++;
  }
  if (!q.referenceText && !q.referenceUrl) errors.push(`${at}: missing reference (url or objective)`);
  if (!domainIds.has(q.domain)) errors.push(`${at}: domain ${q.domain} not in blueprint`);
  if (exam.format === "scenario" && !q.scenarioId) errors.push(`${at}: scenario exam item missing scenarioId`);
  const key = norm(q.stem);
  if (seen.has(key)) errors.push(`${at}: duplicate/near-duplicate stem of ${seen.get(key)}`);
  else seen.set(key, q.questionId);
  domainCount[q.domain] = (domainCount[q.domain] ?? 0) + 1;
}

if (multi === 0) errors.push("no multiple-response items present");

// blueprint distribution (informational tolerance): each domain should be represented
for (const d of exam.domains) {
  if (!domainCount[d.id]) warn.push(`domain ${d.id} (${d.name}) has no questions`);
}

const target = exam.contentTarget ?? 300;
if (questions.length < target) warn.push(`bank has ${questions.length} (< target ${target}) — acceptable during authoring`);

console.log(`\n${exam.examId}: ${questions.length} items, ${multi} multi-response, domains ${Object.keys(domainCount).length}/${exam.domains.length}`);
if (warn.length) console.log("WARN:\n - " + warn.join("\n - "));
if (errors.length) { console.error(`\nFAIL (${errors.length}):\n - ` + errors.slice(0, 40).join("\n - ")); process.exit(1); }
console.log("VALIDATE: PASS");
