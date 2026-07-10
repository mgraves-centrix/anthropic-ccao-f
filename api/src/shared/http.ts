// HTTP helpers for the Function adapters. Principal + roles are derived from the
// SWA-injected header — never from the request body (spec §III.7).
import type { HttpRequest, HttpResponseInit } from "@azure/functions";
import { parsePrincipal, hasRole, type ClientPrincipal } from "./auth.js";
import type { Role } from "./types.js";

export function principalOf(req: HttpRequest): ClientPrincipal | null {
  return parsePrincipal(req.headers.get("x-ms-client-principal"));
}

export function json(status: number, body: unknown): HttpResponseInit {
  return { status, jsonBody: body };
}

export class HttpError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

/** Require an authenticated principal holding `role`. Returns it or throws. */
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

export async function handle(fn: () => Promise<HttpResponseInit>): Promise<HttpResponseInit> {
  try {
    return await fn();
  } catch (e: unknown) {
    const status = (e as { status?: number }).status ?? 500;
    const message = (e as { message?: string }).message ?? "error";
    return json(status, { error: message });
  }
}

export async function body<T>(req: HttpRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
