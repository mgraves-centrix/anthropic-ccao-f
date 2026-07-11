// HTTP helpers for the Function adapters. Principal + roles are derived from the
// SWA-injected header — never from the request body (spec §III.7). Adds rate-limit
// enforcement (§15) via the shared limiter.
import type { HttpRequest, HttpResponseInit } from "@azure/functions";
import { parsePrincipal, hasRole, type ClientPrincipal } from "./auth.js";
import type { Role } from "./types.js";
import { limiter, LIMITS } from "./ratelimit.js";
import { durableLimiter } from "./context.js";

export function principalOf(req: HttpRequest): ClientPrincipal | null {
  return parsePrincipal(req.headers.get("x-ms-client-principal"));
}

export function json(status: number, body: unknown, headers?: Record<string, string>): HttpResponseInit {
  return headers ? { status, jsonBody: body, headers } : { status, jsonBody: body };
}

export class HttpError extends Error {
  constructor(public status: number, msg: string, public headers?: Record<string, string>) { super(msg); }
}

/** Require an authenticated principal holding `role`. Returns it or throws 401/403. */
export function require(req: HttpRequest, role: Role): ClientPrincipal {
  const p = principalOf(req);
  if (!p) throw new HttpError(401, "unauthenticated");
  if (!hasRole(p.userRoles, role)) throw new HttpError(403, "forbidden");
  return p;
}

/** Require only authentication (used by request-access). */
export function requireAuthed(req: HttpRequest): ClientPrincipal {
  const p = principalOf(req);
  if (!p) throw new HttpError(401, "unauthenticated");
  return p;
}

/**
 * Enforce auth (role) AND a per-user/route rate limit (§15). Returns the
 * principal or throws 401/403/429 (429 carries a Retry-After header).
 * `routeKey` selects a bucket in LIMITS; omit to skip rate limiting.
 */
export function enforce(req: HttpRequest, role: Role, routeKey?: keyof typeof LIMITS): Promise<ClientPrincipal> {
  return rateLimit(require(req, role), routeKey);
}

/** Like enforce but only requires authentication (used by self-service access requests). */
export function enforceAuthed(req: HttpRequest, routeKey?: keyof typeof LIMITS): Promise<ClientPrincipal> {
  return rateLimit(requireAuthed(req), routeKey);
}

async function rateLimit(p: ClientPrincipal, routeKey?: keyof typeof LIMITS): Promise<ClientPrincipal> {
  if (!routeKey) return p;
  const spec = LIMITS[routeKey];
  // In-memory tier first: cheap, zero-I/O, and short-circuits abuse per instance.
  const local = limiter.check(p.userId, routeKey, spec);
  if (!local.ok) throw tooMany(local.retryAfterMs);
  // Durable tier for the security-sensitive buckets, if a Table backend exists.
  if (spec.durable) {
    const durable = durableLimiter();
    if (durable) {
      const r = await durable.check(p.userId, routeKey, spec);
      if (!r.ok) throw tooMany(r.retryAfterMs);
    }
  }
  return p;
}

function tooMany(retryAfterMs: number): HttpError {
  return new HttpError(429, "rate limit exceeded", { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) });
}

export async function handle(fn: () => Promise<HttpResponseInit>): Promise<HttpResponseInit> {
  try {
    return await fn();
  } catch (e: unknown) {
    const status = (e as { status?: number }).status ?? 500;
    // Only surface messages for intentional (4xx) errors; never leak internal 5xx detail.
    const message = status >= 500 ? "internal error" : ((e as { message?: string }).message ?? "error");
    const headers = (e as { headers?: Record<string, string> }).headers;
    const data = status < 500 ? (e as { data?: Record<string, unknown> }).data : undefined;
    return json(status, { error: message, ...(data ?? {}) }, headers);
  }
}

export async function body<T>(req: HttpRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
