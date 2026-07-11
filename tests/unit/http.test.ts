import { describe, it, expect, beforeEach } from "vitest";
import type { HttpRequest } from "@azure/functions";
import { principalOf, json, HttpError, require as requireRole, requireAuthed, enforce, handle, body } from "../../api/src/shared/http.js";
import { limiter } from "../../api/src/shared/ratelimit.js";
import type { ClientPrincipal } from "../../api/src/shared/auth.js";

function header(p: Partial<ClientPrincipal>): string {
  return Buffer.from(JSON.stringify({ identityProvider: "aad", userId: "u", userDetails: "u@x", userRoles: [], ...p })).toString("base64");
}
function req(opts: { principal?: string | null; jsonBody?: unknown; jsonThrows?: boolean } = {}): HttpRequest {
  return {
    headers: { get: (k: string) => (k === "x-ms-client-principal" ? (opts.principal ?? null) : null) },
    query: { get: () => null },
    params: {},
    json: async () => { if (opts.jsonThrows) throw new Error("bad json"); return opts.jsonBody; },
  } as unknown as HttpRequest;
}

beforeEach(() => limiter.reset());

describe("principalOf / parse", () => {
  it("decodes a valid base64 principal header", () => {
    const p = principalOf(req({ principal: header({ userId: "abc", userRoles: ["authorized"] }) }));
    expect(p?.userId).toBe("abc");
    expect(p?.userRoles).toContain("authorized");
  });
  it("returns null for missing or garbage headers", () => {
    expect(principalOf(req({ principal: null }))).toBeNull();
    expect(principalOf(req({ principal: "not-base64-json" }))).toBeNull();
  });
});

describe("require / requireAuthed — role gating", () => {
  it("401 when unauthenticated", () => {
    expect(() => requireRole(req({ principal: null }), "authorized")).toThrow(HttpError);
    try { requireRole(req({ principal: null }), "authorized"); } catch (e) { expect((e as HttpError).status).toBe(401); }
  });
  it("403 when authenticated but missing the role", () => {
    try { requireRole(req({ principal: header({ userRoles: ["authenticated"] }) }), "authorized"); }
    catch (e) { expect((e as HttpError).status).toBe(403); }
  });
  it("returns the principal when the role is present", () => {
    const p = requireRole(req({ principal: header({ userRoles: ["authorized"] }) }), "authorized");
    expect(p.userId).toBe("u");
  });
  it("requireAuthed accepts any authenticated principal, rejects none", () => {
    expect(requireAuthed(req({ principal: header({}) })).userId).toBe("u");
    try { requireAuthed(req({ principal: null })); } catch (e) { expect((e as HttpError).status).toBe(401); }
  });
});

describe("enforce — role + rate limit", () => {
  it("allows up to the limit then throws 429 with Retry-After", () => {
    const authed = () => req({ principal: header({ userId: "rl", userRoles: ["authorized"] }) });
    for (let i = 0; i < 10; i++) expect(enforce(authed(), "authorized", "submit").userId).toBe("rl"); // submit limit = 10
    try { enforce(authed(), "authorized", "submit"); expect.unreachable(); }
    catch (e) {
      expect((e as HttpError).status).toBe(429);
      expect((e as HttpError).headers?.["Retry-After"]).toBeDefined();
    }
  });
  it("still enforces role before rate limit", () => {
    try { enforce(req({ principal: header({ userRoles: [] }) }), "authorized", "read"); }
    catch (e) { expect((e as HttpError).status).toBe(403); }
  });
});

describe("handle — error → status mapping", () => {
  it("passes through a successful response", async () => {
    expect(await handle(async () => json(200, { ok: true }))).toMatchObject({ status: 200 });
  });
  it("maps HttpError status + headers", async () => {
    const res = await handle(async () => { throw new HttpError(429, "rate", { "Retry-After": "3600" }); });
    expect(res.status).toBe(429);
    expect((res as { headers?: Record<string, string> }).headers?.["Retry-After"]).toBe("3600");
  });
  it("maps a ServiceError-like {status} (e.g. 409)", async () => {
    const res = await handle(async () => { throw Object.assign(new Error("stale"), { status: 409 }); });
    expect(res.status).toBe(409);
  });
  it("defaults to 500 for an unknown error", async () => {
    const res = await handle(async () => { throw new Error("boom"); });
    expect(res.status).toBe(500);
  });
});

describe("body", () => {
  it("parses JSON and tolerates bad bodies", async () => {
    expect(await body(req({ jsonBody: { a: 1 } }))).toEqual({ a: 1 });
    expect(await body(req({ jsonThrows: true }))).toEqual({});
  });
});
