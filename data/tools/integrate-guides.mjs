// Write authored study guides to per-exam source files.
// Usage: node data/tools/integrate-guides.mjs <guides-output.json>
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const DIR = { "CCDV-F": "ccdv-f", "CCAR-F": "ccar-f", "CCAR-P": "ccar-p", "CCAO-F": "ccao-f" };

function extract(raw) {
  const o = JSON.parse(raw);
  return o.guides || (o.result && o.result.guides) || null;
}

const guides = extract(readFileSync(process.argv[2], "utf8"));
if (!guides) { console.error("no guides in output"); process.exit(1); }

for (const [examId, guide] of Object.entries(guides)) {
  const dir = DIR[examId];
  if (!dir || !guide) { console.error(`skip ${examId}`); continue; }
  const dest = new URL(`../${dir}/studyguide.source.json`, import.meta.url);
  if (existsSync(dest) && examId === "CCAO-F") { console.log(`${examId}: kept existing`); continue; }
  writeFileSync(dest, JSON.stringify(guide, null, 2));
  console.log(`${examId}: ${guide.sections?.length ?? 0} sections written`);
}
console.log("guides integrated");
