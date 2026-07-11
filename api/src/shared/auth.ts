// ============================================================================
// Auth: parse the SWA client principal, derive identity, resolve roles, and
// enforce the self-service auto-approve rule (spec §III.6/§III.6a/§III.7).
// userId/roles are ALWAYS derived server-side — never from the request body.
// ============================================================================
import type { UsersRepo } from "./repos.js";
import type { AuthorizedUserRow, Role } from "./types.js";

export interface ClientPrincipal {
  identityProvider: string;
  userId: string;
  userDetails: string;
  userRoles: string[];
  claims?: { typ: string; val: string }[];
}

export function parsePrincipal(header: string | null | undefined): ClientPrincipal | null {
  if (!header) return null;
  try {
    const json = Buffer.from(header, "base64").toString("utf8");
    const p = JSON.parse(json) as ClientPrincipal;
    if (!p.userId || !p.identityProvider) return null;
    return p;
  } catch {
    return null;
  }
}

/** Returns an email ONLY when it is a trusted, verified claim (Entra/aad). */
export function getVerifiedEmail(p: ClientPrincipal): string | null {
  if (p.identityProvider !== "aad") return null; // GitHub emails are not trusted for auto-approve
  const claims = p.claims ?? [];
  const pick = (typ: string) => claims.find((c) => c.typ === typ)?.val;
  const email =
    pick("emails") ||
    pick("email") ||
    pick("preferred_username") ||
    pick("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress") ||
    (p.userDetails.includes("@") ? p.userDetails : undefined);
  return email ? email.toLowerCase() : null;
}

export function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : null;
}

/** Exact (not endsWith) domain match against the configured allowlist. */
export function isAutoApproveDomain(email: string | null, domainsCsv: string | undefined): boolean {
  if (!email || !domainsCsv) return false;
  const d = domainOf(email);
  if (!d) return false;
  const allow = domainsCsv.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return allow.includes(d);
}

export interface AuthConfig {
  authzMode: "allowlist" | "github-org" | "both";
  autoApproveDomains?: string;
  githubOrg?: string;
  githubTeam?: string;
}

/** Optional injected GitHub org-membership check (kept out of core for testability). */
export type OrgMembershipCheck = (githubLogin: string) => Promise<boolean>;

/**
 * Build a real GitHub org/team membership check (spec §III.6 github-org mode).
 * Uses a read-only token; fails CLOSED on any error. fetchImpl is injectable for tests.
 */
export function makeGithubOrgCheck(
  token: string, org: string, team?: string, fetchImpl: typeof fetch = fetch,
): OrgMembershipCheck {
  return async (login: string): Promise<boolean> => {
    if (!login || !token || !org) return false;
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "cert-portal" };
    try {
      if (team) {
        const url = `https://api.github.com/orgs/${encodeURIComponent(org)}/teams/${encodeURIComponent(team)}/memberships/${encodeURIComponent(login)}`;
        const r = await fetchImpl(url, { headers });
        if (!r.ok) return false;
        const b = (await r.json().catch(() => ({}))) as { state?: string };
        return b.state === "active";
      }
      const url = `https://api.github.com/orgs/${encodeURIComponent(org)}/members/${encodeURIComponent(login)}`;
      const r = await fetchImpl(url, { headers });
      return r.status === 204; // 204 = member, 404 = not a member
    } catch {
      return false; // fail closed
    }
  };
}

/** Resolve the caller's custom roles (rolesSource=/api/GetRoles). Never trusts client roles. */
export async function resolveRoles(
  p: ClientPrincipal,
  users: UsersRepo,
  cfg: AuthConfig,
  orgCheck?: OrgMembershipCheck,
): Promise<Role[]> {
  const roles = new Set<Role>();

  if (cfg.authzMode === "allowlist" || cfg.authzMode === "both") {
    const u = await users.get(p.identityProvider, p.userId);
    if (u && u.status === "active") {
      roles.add("authorized");               // every active user can use the portal
      if (u.role !== "authorized") roles.add(u.role); // admins/reviewers get their extra role too
    }
  }
  if ((cfg.authzMode === "github-org" || cfg.authzMode === "both") && p.identityProvider === "github" && cfg.githubOrg) {
    if (orgCheck && (await orgCheck(p.userDetails))) roles.add("authorized");
  }
  return [...roles];
}

export function hasRole(roles: string[] | undefined, role: Role): boolean {
  return !!roles && roles.includes(role);
}

/** Build an AuthorizedUser row from a principal for a new access request. */
export function newRequestRow(
  p: ClientPrincipal,
  justification: string,
  status: AuthorizedUserRow["status"],
  role: Role,
  now: string,
): AuthorizedUserRow {
  const email = getVerifiedEmail(p) ?? (p.userDetails.includes("@") ? p.userDetails.toLowerCase() : "");
  const row: AuthorizedUserRow = {
    provider: p.identityProvider, providerUserId: p.userId, role, status,
    email, displayName: p.userDetails, requestedAt: now,
  };
  if (justification) row.justification = justification.slice(0, 500);
  return row;
}
