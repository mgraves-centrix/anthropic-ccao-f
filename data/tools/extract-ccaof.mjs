// Extract the legacy self-contained CCAO-F app into source data (spec §III.10,
// migration §7). Reads window.__CCAOF__ from index.html and writes normalized
// source files. The legacy inlined answer key is thereby moved to a *source*
// artifact; at cutover the open index.html is retired.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const m = html.match(/window\.__CCAOF__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
if (!m) { console.error("Could not find window.__CCAOF__"); process.exit(1); }
const data = JSON.parse(m[1]);

const outDir = new URL("../ccao-f/", import.meta.url);
mkdirSync(outDir, { recursive: true });

// exam meta
const domains = data.questions.meta.domains.map((d) => ({ id: d.id, name: d.name, weight: d.weight }));
const exam = {
  examId: "CCAO-F",
  name: "Claude Certified Associate – Foundations",
  itemCount: 60, timeLimitMin: 120, cutScore: 720, scaleMin: 100, scaleMax: 1000,
  format: "standard", price: 99, status: "live",
  domains,
  theme: {
    accent: "#3b44d9", accentInk: "#2a31a8", accentTint: "#ececfb",
    accentDark: "#8b93ff", accentInkDark: "#b6bbff", accentTintDark: "#23253a", onAccent: "#ffffff",
  },
};

// Targeted legacy fixes applied during migration (dedupe near-duplicate stems the
// validator flags). Each is a deliberate item-writer differentiation, not a data hack.
const LEGACY_FIXES = {
  // D1-33 shared a verbatim stem with D1-30; reframe as a distinct application item.
  "D1-33": { stem: "A user wants consistently strong results from Claude. Which practices reflect documented prompt-engineering guidance? (Select THREE.)" },
};

// questions — normalize legacy shape → source schema
const questions = data.questions.questions.map((q) => {
  const type = q.type === "multi" || q.type === "multiple" ? "multiple" : "single";
  const fix = LEGACY_FIXES[q.id] ?? {};
  const item = {
    examId: "CCAO-F", questionId: q.id, domain: q.domain, type,
    stem: fix.stem ?? q.question, options: fix.options ?? q.options, correct: fix.correct ?? q.correct,
    rationale: q.rationale, referenceText: q.source || "",
    status: "published",
  };
  if (q.sourceUrl) item.referenceUrl = q.sourceUrl;
  if (type === "multiple") item.selectCount = q.correct.length;
  return item;
});

writeFileSync(new URL("exam.json", outDir), JSON.stringify(exam, null, 2));
writeFileSync(new URL("questions.source.json", outDir), JSON.stringify(questions, null, 2));
writeFileSync(new URL("studyguide.source.json", outDir), JSON.stringify(data.guide, null, 2));

console.log(`CCAO-F extracted: ${questions.length} questions, ${domains.length} domains, ${data.guide.sections.length} guide sections.`);
