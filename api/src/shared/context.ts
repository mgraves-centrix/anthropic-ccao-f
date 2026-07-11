// Wire repos + config from environment (spec §III.1). Managed identity in cloud
// (TABLES_ACCOUNT_URL) or Azurite connection string locally.
import { AzureTableRepo } from "./tables.js";
import { ExamsRepo, QuestionsRepo, ScenariosRepo, AttemptsRepo, UsersRepo, StudyGuideRepo, BookmarksRepo, StatsRepo } from "./repos.js";
import { DurableRateLimiter } from "./ratelimit.js";
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
    bookmarks: new BookmarksRepo(AzureTableRepo.forTable("Bookmarks")),
    stats: new StatsRepo(AzureTableRepo.forTable("QuestionStats")),
  };
}

export function auditRepo() {
  return AzureTableRepo.forTable("Audit");
}

// Durable, cross-instance rate limiter backed by the RateLimit table. Returns
// null when no Table backend is configured (tests / local without Azurite), so
// enforce() falls back to the in-memory limiter only.
let _durable: DurableRateLimiter | null | undefined;
export function durableLimiter(): DurableRateLimiter | null {
  if (_durable !== undefined) return _durable;
  if (!process.env.TABLES_CONNECTION_STRING && !process.env.TABLES_ACCOUNT_URL) return (_durable = null);
  return (_durable = new DurableRateLimiter(AzureTableRepo.forTable("RateLimit")));
}

export function authConfig(): AuthConfig {
  const mode = (process.env.AUTHZ_MODE as AuthConfig["authzMode"]) || "allowlist";
  const cfg: AuthConfig = { authzMode: mode };
  if (process.env.AUTO_APPROVE_DOMAINS) cfg.autoApproveDomains = process.env.AUTO_APPROVE_DOMAINS;
  if (process.env.GITHUB_ORG) cfg.githubOrg = process.env.GITHUB_ORG;
  if (process.env.GITHUB_TEAM) cfg.githubTeam = process.env.GITHUB_TEAM;
  if (process.env.NOTIFY_WEBHOOK) cfg.notifyWebhook = process.env.NOTIFY_WEBHOOK;
  return cfg;
}
