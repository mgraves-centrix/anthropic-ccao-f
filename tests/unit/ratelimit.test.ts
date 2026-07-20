import { describe, it, expect } from "vitest";
import { RateLimiter } from "../../api/src/shared/ratelimit.js";

describe("RateLimiter — sliding window", () => {
  it("allows up to the limit, then blocks with retryAfter", () => {
    let now = 1_000_000;
    const rl = new RateLimiter(() => now);
    const spec = { limit: 3, windowMs: 1000 };
    expect(rl.check("u", "submit", spec).ok).toBe(true);
    expect(rl.check("u", "submit", spec).ok).toBe(true);
    expect(rl.check("u", "submit", spec).ok).toBe(true);
    const blocked = rl.check("u", "submit", spec);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(1000);
  });

  it("recovers after the window slides", () => {
    let now = 0;
    const rl = new RateLimiter(() => now);
    const spec = { limit: 1, windowMs: 1000 };
    expect(rl.check("u", "r", spec).ok).toBe(true);
    expect(rl.check("u", "r", spec).ok).toBe(false);
    now = 1001;
    expect(rl.check("u", "r", spec).ok).toBe(true);
  });

  it("isolates per user and per route", () => {
    const rl = new RateLimiter(() => 0);
    const spec = { limit: 1, windowMs: 1000 };
    expect(rl.check("a", "submit", spec).ok).toBe(true);
    expect(rl.check("b", "submit", spec).ok).toBe(true); // different user
    expect(rl.check("a", "answer", spec).ok).toBe(true); // different route
    expect(rl.check("a", "submit", spec).ok).toBe(false); // same user+route exhausted
  });
});
