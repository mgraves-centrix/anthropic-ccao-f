// Security audit log (spec §III.7/§15). Appends events to the Audit table,
// partitioned by day, newest-first within the day. Best-effort: a logging
// failure must never break the request.
import type { TableRepo } from "./tables.js";

export interface AuditEvent {
  userId?: string;
  event: string;        // e.g. "submit", "access.approve", "denied.403", "ratelimited.429"
  route?: string;
  meta?: Record<string, unknown>;
}

const MAX = 9_999_999_999_999n;

export async function audit(
  repo: TableRepo, ev: AuditEvent, now: () => number = Date.now, rand: () => number = Math.random,
): Promise<void> {
  try {
    const t = now();
    const iso = new Date(t).toISOString();
    const inv = (MAX - BigInt(t)).toString().padStart(13, "0");
    await repo.upsert({
      partitionKey: iso.slice(0, 10),
      rowKey: `${inv}|${Math.floor(rand() * 1e6)}`,
      userId: ev.userId ?? "",
      event: ev.event,
      route: ev.route ?? "",
      meta: JSON.stringify(ev.meta ?? {}),
      at: iso,
    });
  } catch {
    /* audit is best-effort; never throw into the request path */
  }
}
