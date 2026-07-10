// Integrate workflow-authored questions into per-exam source banks.
// Usage: node data/tools/integrate-authored.mjs <banks.json> [<banks2.json> ...]
// Each input is JSON containing { banks: { EXAMID: [question, ...] } } (extra
// surrounding text tolerated). Normalizes, drops structurally-invalid items,
// dedupes by stem against existing + new, assigns generated ids, and rewrites
// data/<exam>/questions.source.json.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const DIR = { "CCAO-F": "ccao-f", "CCDV-F": "ccdv-f", "CCAR-F": "ccar-f", "CCAR-P": "ccar-p" };
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

function extractBanks(raw) {
  try { return JSON.parse(raw).banks; } catch { /* fall through */ }
  const i = raw.indexOf('"banks"');
  if (i < 0) return null;
  // find the enclosing object start
  let start = raw.lastIndexOf("{", i);
  for (let depth = 0, j = start; j < raw.length; j++) {
    if (raw[j] === "{") depth++;
    else if (raw[j] === "}") { depth--; if (depth === 0) { try { return JSON.parse(raw.slice(start, j + 1)).banks; } catch { return null; } } }
  }
  return null;
}

function valid(q) {
  if (!q || typeof q.stem !== "string" || norm(q.stem).length < 8) return false;
  if (!Array.isArray(q.options) || q.options.length < 4 || q.options.length > 5) return false;
  if (!Array.isArray(q.correct) || q.correct.length < 1) return false;
  const uniq = [...new Set(q.correct)];
  if (uniq.length !== q.correct.length) return false;
  for (const c of q.correct) if (!Number.isInteger(c) || c < 0 || c >= q.options.length) return false;
  const type = q.type === "multi" ? "multiple" : q.type;
  if (type === "single" && q.correct.length !== 1) return false;
  if (type !== "single" && type !== "multiple") return false;
  if (!q.referenceText && !q.referenceUrl) return false;
  return true;
}

const inputs = process.argv.slice(2);
const merged = {};
for (const f of inputs) {
  const banks = extractBanks(readFileSync(f, "utf8"));
  if (!banks) { console.error(`no banks in ${f}`); continue; }
  for (const [examId, qs] of Object.entries(banks)) (merged[examId] ??= []).push(...(qs || []));
}

let grand = 0;
for (const [examId, newQs] of Object.entries(merged)) {
  const dir = DIR[examId];
  if (!dir) { console.error(`unknown exam ${examId}`); continue; }
  const path = new URL(`../${dir}/questions.source.json`, `file://${process.cwd()}/`);
  const existing = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
  const seen = new Set(existing.map((q) => norm(q.stem)));
  const counters = {};
  let added = 0, dropped = 0, dup = 0;
  const out = [...existing];
  for (const raw of newQs) {
    if (!valid(raw)) { dropped++; continue; }
    const key = norm(raw.stem);
    if (seen.has(key)) { dup++; continue; }
    seen.add(key);
    const type = raw.type === "multi" ? "multiple" : raw.type;
    const base = raw.scenarioId ? `G-${raw.scenarioId}` : `G-D${raw.domain}`;
    counters[base] = (counters[base] ?? 0) + 1;
    const item = {
      examId, questionId: `${base}-${String(counters[base]).padStart(3, "0")}`,
      domain: raw.domain, type, stem: raw.stem.trim(), options: raw.options,
      correct: raw.correct, rationale: raw.rationale || "", referenceText: raw.referenceText || "",
      status: "published",
    };
    if (raw.scenarioId) item.scenarioId = raw.scenarioId;
    if (raw.referenceUrl) item.referenceUrl = raw.referenceUrl;
    if (type === "multiple") item.selectCount = raw.correct.length;
    out.push(item);
    added++;
  }
  writeFileSync(path, JSON.stringify(out, null, 2));
  grand += out.length;
  console.log(`${examId}: +${added} added (${dup} dup, ${dropped} invalid dropped) → ${out.length} total`);
}
console.log(`grand total across integrated exams: ${grand}`);
