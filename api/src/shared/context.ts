// Wire repos + config from environment (spec §III.1). Managed identity in cloud
// (TABLES_ACCOUNT_URL) or Azurite connection string locally.
import { AzureTableRepo } from "./tables.js";
import { ExamsRepo, QuestionsRepo, ScenariosRepo, AttemptsRepo, UsersRepo, StudyGuideRepo } from "./repos.js";
import type { Ctx } from "./service.js";
import type { AuthConfig } from "./auth.js";

export function ctxFromEnv(): Ctx {
  return {
    exams: new ExamsRepo(AzureTableRepo.forTable("Exams")),
    questions: new QuestionsRepo(AzureTableRepo.forTable("Questions")),
    scenarios: new ScenariosRepo(AzureTableRepo.forTable("Scenarios")),
    attempts: new AttemptsRepo(AzureTableRepo.forTable("Attempts")),
    users: new UsersRepo(AzureTableRepo.forTable("Users")),
    study: new StudyGuideRepo(AzureTableRepo.forTable("StudyGuide")),
  };
}

export function auditRepo() {
  return AzureTableRepo.forTable("Audit");
}

export function authConfig(): AuthConfig {
  const mode = (process.env.AUTHZ_MODE as AuthConfig["authzMode"]) || "allowlist";
  const cfg: AuthConfig = { authzMode: mode };
  if (process.env.AUTO_APPROVE_DOMAINS) cfg.autoApproveDomains = process.env.AUTO_APPROVE_DOMAINS;
  if (process.env.GITHUB_ORG) cfg.githubOrg = process.env.GITHUB_ORG;
  if (process.env.GITHUB_TEAM) cfg.githubTeam = process.env.GITHUB_TEAM;
  return cfg;
}
