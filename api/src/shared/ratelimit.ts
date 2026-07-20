// Per-user, per-route rate limiter (spec §III.7/§15).
//
// Two tiers, composed by http.enforce():
//  - RateLimiter (below): in-memory sliding window, per Function instance. Fast,
//    zero-I/O; the first line of defence and the only tier for high-volume,
//    low-risk buckets (read/save).
//  - DurableRateLimiter: Table-backed fixed-window counter shared across all
//    instances. Used for the security-sensitive buckets (submit/answer/attempts)
//    where a per-instance limit could be bypassed by a scaled-out plan or reset
//    by a cold start — closing the anti key-harvest gap. Degrades to in-memory
//    only when no Table backend is configured (tests / local without Azurite).
export interface RateSpec { limit: number; windowMs: number; durable?: boolean; }

const HOUR = 3600_000;
export const LIMITS: Record<string, RateSpec> = {
  submit: { limit: 10, windowMs: HOUR, durable: true },    // anti key-harvest — the tightest
  answer: { limit: 120, windowMs: HOUR, durable: true },
  attempts: { limit: 30, windowMs: HOUR, durable: true },
  save: { limit: 600, windowMs: HOUR },
  read: { limit: 300, windowMs: HOUR },     // catalog / history / study / access
};

export interface RateResult { ok: boolean; remaining: number; retryAfterMs: number; }

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private now: () => number = Date.now) {}

  check(userId: string, route: string, spec: RateSpec): RateResult {
    const t = this.now();
    const key = `${userId}|${route}`;
    const arr = (this.hits.get(key) ?? []).filter((ts) => ts > t - spec.windowMs);
    if (arr.length >= spec.limit) {
      this.hits.set(key, arr);
      const retryAfterMs = Math.max(0, arr[0]! + spec.windowMs - t);
      return { ok: false, remaining: 0, retryAfterMs };
    }
    arr.push(t);
    this.hits.set(key, arr);
    return { ok: true, remaining: spec.limit - arr.length, retryAfterMs: 0 };
  }

  reset(): void { this.hits.clear(); }
}

/** Shared process-wide limiter used by the Functions. */
export const limiter = new RateLimiter();

// ---- Durable (Table-backed) fixed-window limiter ---------------------------
// Minimal surface the limiter needs from a Table backend (see tables.ts).
export interface RateStore {
  getWithEtag(pk: string, rk: string): Promise<{ entity: Record<string, unknown>; etag: string } | undefined>;
  insert(entity: Record<string, unknown>): Promise<void>;
  replace(entity: Record<string, unknown>, etag: string): Promise<void>;
}

export class DurableRateLimiter {
  constructor(private store: RateStore, private now: () => number = Date.now, private maxRetries = 6) {}

  /**
   * Fixed-window counter keyed by (userId, `route|windowStart`), incremented with
   * optimistic concurrency (insert-if-absent, else replace-if-etag-matches). On
   * write contention we re-read and retry; if retries are exhausted we fail OPEN
   * (allow) to preserve availability — at team scale contention is negligible.
   */
  async check(userId: string, route: string, spec: RateSpec): Promise<RateResult> {
    const t = this.now();
    const windowStart = Math.floor(t / spec.windowMs) * spec.windowMs;
    const rk = `${route}|${windowStart}`;
    const retryAfterMs = Math.max(0, windowStart + spec.windowMs - t);

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const cur = await this.store.getWithEtag(userId, rk);
      if (!cur) {
        try {
          await this.store.insert({
            partitionKey: userId, rowKey: rk, count: 1, windowStart,
            expiresAt: new Date(windowStart + spec.windowMs).toISOString(),
          });
          return { ok: true, remaining: spec.limit - 1, retryAfterMs: 0 };
        } catch (e) { if ((e as { status?: number }).status === 409) continue; throw e; }
      }
      const count = (cur.entity.count as number) ?? 0;
      if (count >= spec.limit) return { ok: false, remaining: 0, retryAfterMs };
      try {
        await this.store.replace({ ...cur.entity, count: count + 1 }, cur.etag);
        return { ok: true, remaining: spec.limit - count - 1, retryAfterMs: 0 };
      } catch (e) { if ((e as { status?: number }).status === 412) continue; throw e; }
    }
    return { ok: true, remaining: 0, retryAfterMs: 0 }; // contention — fail open
  }
}
