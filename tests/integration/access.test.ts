import { describe, it, expect } from "vitest";
import { buildCtx, principal } from "./helpers.js";
import { accessRequest, listPending, decideRequest } from "../../api/src/shared/service.js";
import { resolveRoles, type AuthConfig } from "../../api/src/shared/auth.js";

const cfg: AuthConfig = { authzMode: "allowlist", autoApproveDomains: "majorkeytech.com,centrixlabs.com,identityfabric.ai" };
const now = Date.parse("2026-07-10T12:00:00Z");

describe("self-service registration + auto-approve", () => {
  it("auto-approves a verified auto-approve domain (Entra)", async () => {
    const ctx = await buildCtx();
    const p = principal("aad", "u-centrix", { email: "sam@centrixlabs.com" });
    const res = await accessRequest(p, "let me in", ctx, cfg, { now });
    expect(res.status).toBe("active");
    expect(await resolveRoles(p, ctx.users, cfg)).toEqual(["authorized"]);
  });

  it("case-insensitive domain match", async () => {
    const ctx = await buildCtx();
    const p = principal("aad", "u-mixed", { email: "Sam@IdentityFabric.AI" });
    expect((await accessRequest(p, "", ctx, cfg, { now })).status).toBe("active");
  });

  it("rejects lookalike domains (exact match, not endsWith)", async () => {
    const ctx = await buildCtx();
    const p = principal("aad", "u-evil", { email: "a@evil-centrixlabs.com" });
    expect((await accessRequest(p, "", ctx, cfg, { now })).status).toBe("pending");
  });

  it("does NOT auto-approve unverified GitHub email even on an allowed domain", async () => {
    const ctx = await buildCtx();
    const p = principal("github", "gh-1", { email: "sam@centrixlabs.com" });
    expect((await accessRequest(p, "", ctx, cfg, { now })).status).toBe("pending");
  });

  it("other domains go pending → admin approves → authorized", async () => {
    const ctx = await buildCtx();
    const p = principal("aad", "u-other", { email: "x@contoso.com" });
    expect((await accessRequest(p, "need access", ctx, cfg, { now })).status).toBe("pending");
    expect(await resolveRoles(p, ctx.users, cfg)).toEqual([]); // pending ≠ access

    const admin = principal("aad", "admin-1", { roles: ["authenticated", "admin"] });
    const pending = await listPending(admin, ctx);
    expect(pending).toHaveLength(1);
    await decideRequest(admin, "aad", "u-other", "approve", "authorized", ctx, { now });
    expect(await resolveRoles(p, ctx.users, cfg)).toEqual(["authorized"]);
  });

  it("non-admin cannot list or decide", async () => {
    const ctx = await buildCtx();
    const notAdmin = principal("aad", "u", { roles: ["authenticated", "authorized"] });
    await expect(listPending(notAdmin, ctx)).rejects.toMatchObject({ status: 403 });
  });
});

describe("resolveRoles — github-org mode", () => {
  it("grants authorized when the injected org check passes", async () => {
    const ctx = await buildCtx();
    const p = principal("github", "octocat", { email: "octo@example.com" });
    const orgCfg: AuthConfig = { authzMode: "github-org", githubOrg: "myorg" };
    expect(await resolveRoles(p, ctx.users, orgCfg, async () => true)).toEqual(["authorized"]);
    expect(await resolveRoles(p, ctx.users, orgCfg, async () => false)).toEqual([]);
  });
});
