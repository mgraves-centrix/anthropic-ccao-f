import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const cfg = JSON.parse(readFileSync(new URL("../../staticwebapp.config.json", import.meta.url), "utf8"));

describe("staticwebapp.config.json — auth & route gating", () => {
  it("uses /api/GetRoles as the roles source", () => {
    expect(cfg.auth.rolesSource).toBe("/api/GetRoles");
  });
  it("gates /api/* and /* to the authorized role", () => {
    const byRoute = Object.fromEntries(cfg.routes.map((r: { route: string; allowedRoles?: string[] }) => [r.route, r.allowedRoles]));
    expect(byRoute["/api/*"]).toEqual(["authorized"]);
    expect(byRoute["/*"]).toEqual(["authorized"]);
    expect(byRoute["/admin/*"]).toEqual(["admin"]);
  });
  it("allows the login + auth surface anonymously", () => {
    const login = cfg.routes.find((r: { route: string }) => r.route === "/login");
    expect(login.allowedRoles).toContain("anonymous");
  });
  it("redirects 401→login and rewrites 403→request-access", () => {
    expect(cfg.responseOverrides["401"].redirect).toBe("/login");
    expect(cfg.responseOverrides["403"].rewrite).toBe("/request-access.html");
  });
});

describe("staticwebapp.config.json — security headers", () => {
  const h = () => cfg.globalHeaders as Record<string, string>;
  it("sets a strict CSP (self, no frame ancestors)", () => {
    expect(h()["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(h()["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h()["Content-Security-Policy"]).not.toContain("unsafe-inline");
  });
  it("sets HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy", () => {
    expect(h()["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
    expect(h()["X-Content-Type-Options"]).toBe("nosniff");
    expect(h()["X-Frame-Options"]).toBe("DENY");
    expect(h()["Referrer-Policy"]).toBeTruthy();
    expect(h()["Permissions-Policy"]).toBeTruthy();
  });
});
