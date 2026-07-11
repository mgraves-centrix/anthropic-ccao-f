// Seed exams/questions/scenarios/study-guide (+ optional first admin) into Table
// Storage (spec §III.10). Reuses the compiled repositories so serialization
// exactly matches the API. Uses managed identity (TABLES_ACCOUNT_URL) in cloud
// or Azurite (TABLES_CONNECTION_STRING=UseDevelopmentStorage=true) locally.
//
// Usage:
//   node data/tools/seed-tables.mjs --exam data/ccao-f [--exam data/ccar-f ...]
//   node data/tools/seed-tables.mjs --admin "aad|<object-id>" --email you@example.com
import { readFileSync, existsSync } from "node:fs";
import { AzureTableRepo } from "../../api/dist/shared/tables.js";
import { ExamsRepo, QuestionsRepo, ScenariosRepo, UsersRepo, StudyGuideRepo } from "../../api/dist/shared/repos.js";

const args = process.argv.slice(2);
const examDirs = [];
let adminKey = null, adminEmail = "";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--exam") examDirs.push(args[++i]);
  else if (args[i] === "--admin") adminKey = args[++i];
  else if (args[i] === "--email") adminEmail = args[++i];
}

if (!process.env.TABLES_CONNECTION_STRING && !process.env.TABLES_ACCOUNT_URL) {
  process.env.TABLES_CONNECTION_STRING = "UseDevelopmentStorage=true"; // default: Azurite
}

const repos = {
  Exams: AzureTableRepo.forTable("Exams"),
  Questions: AzureTableRepo.forTable("Questions"),
  Scenarios: AzureTableRepo.forTable("Scenarios"),
  Attempts: AzureTableRepo.forTable("Attempts"),
  Users: AzureTableRepo.forTable("Users"),
  StudyGuide: AzureTableRepo.forTable("StudyGuide"),
  Audit: AzureTableRepo.forTable("Audit"),
};
for (const r of Object.values(repos)) await r.ensureTable();

const examsRepo = new ExamsRepo(repos.Exams);
const questionsRepo = new QuestionsRepo(repos.Questions);
const scenariosRepo = new ScenariosRepo(repos.Scenarios);
const usersRepo = new UsersRepo(repos.Users);
const studyRepo = new StudyGuideRepo(repos.StudyGuide);
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

for (const dir of examDirs) {
  const exam = readJson(`${dir}/exam.json`);
  await examsRepo.put(exam);
  const qs = readJson(`${dir}/questions.source.json`);
  for (const q of qs) await questionsRepo.put(q);
  let scen = 0;
  if (existsSync(`${dir}/scenarios.source.json`)) {
    for (const s of readJson(`${dir}/scenarios.source.json`)) { await scenariosRepo.put(s); scen++; }
  }
  if (existsSync(`${dir}/studyguide.source.json`)) {
    await studyRepo.put(exam.examId, readJson(`${dir}/studyguide.source.json`));
  }
  console.log(`seeded ${exam.examId}: ${qs.length} questions, ${scen} scenarios`);
}

if (adminKey) {
  const [provider, providerUserId] = adminKey.split("|");
  await usersRepo.put({
    provider, providerUserId, role: "admin", status: "active",
    email: adminEmail, displayName: adminEmail || providerUserId,
    requestedAt: new Date().toISOString(),
  });
  console.log(`seeded admin: ${adminKey}`);
}
console.log("SEED: done");
