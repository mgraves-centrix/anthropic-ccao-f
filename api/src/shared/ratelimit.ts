// Per-user, per-route sliding-window rate limiter (spec §III.7/§15). In-memory
// per instance (sufficient at team scale); injectable clock for tests. Returns
// 429 semantics via ok/retryAfterMs.
export interface RateSpec { limit: number; windowMs: number; }

const HOUR = 3600_000;
export const LIMITS: Record<string, RateSpec> = {
  submit: { limit: 10, windowMs: HOUR },   // anti key-harvest — the tightest
  answer: { limit: 120, windowMs: HOUR },
  attempts: { limit: 30, windowMs: HOUR },
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
