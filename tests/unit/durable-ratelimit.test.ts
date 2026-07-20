import { describe, it, expect } from "vitest";
import { DurableRateLimiter } from "../../api/src/shared/ratelimit.js";
import { MemoryTableRepo } from "../../api/src/shared/tables.js";

const HOUR = 3600_000;
const spec = { limit: 3, windowMs: HOUR, durable: true };

describe("DurableRateLimiter (Table-backed fixed window)", () => {
  it("allows up to the limit, then blocks with a Retry-After", async () => {
    const store = new MemoryTableRepo();
    let t = 1_000_000;
    const rl = new DurableRateLimiter(store, () => t);
    for (let i = 0; i < 3; i++) {
      const r = await rl.check("u1", "submit", spec);
      expect(r.ok).toBe(true);
      expect(r.remaining).toBe(2 - i);
    }
    const blocked = await rl.check("u1", "submit", spec);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(HOUR);
  });

  it("counts each user independently", async () => {
    const store = new MemoryTableRepo();
    const rl = new DurableRateLimiter(store, () => 5_000_000);
    for (let i = 0; i < 3; i++) await rl.check("a", "submit", spec);
    expect((await rl.check("a", "submit", spec)).ok).toBe(false);
    expect((await rl.check("b", "submit", spec)).ok).toBe(true); // b unaffected
  });

  it("resets when the fixed window rolls over", async () => {
    const store = new MemoryTableRepo();
    let t = 0;
    const rl = new DurableRateLimiter(store, () => t);
    for (let i = 0; i < 3; i++) await rl.check("u", "submit", spec);
    expect((await rl.check("u", "submit", spec)).ok).toBe(false);
    t += HOUR; // next window
    expect((await rl.check("u", "submit", spec)).ok).toBe(true);
  });

  it("persists across limiter instances sharing a store (cross-instance)", async () => {
    const store = new MemoryTableRepo();
    const now = () => 9_000_000;
    const a = new DurableRateLimiter(store, now); // "instance A"
    const b = new DurableRateLimiter(store, now); // "instance B"
    await a.check("u", "submit", spec);
    await b.check("u", "submit", spec);
    await a.check("u", "submit", spec);
    // fourth hit on either instance is over the shared limit
    expect((await b.check("u", "submit", spec)).ok).toBe(false);
  });

  it("fails open when write contention exhausts retries", async () => {
    // A store whose replace always reports a version conflict — the limiter
    // should give up retrying and allow, never throw or hang.
    const store = new MemoryTableRepo();
    await store.insert({ partitionKey: "u", rowKey: "submit|0", count: 1, windowStart: 0 });
    const conflicting = {
      getWithEtag: (pk: string, rk: string) => store.getWithEtag(pk, rk),
      insert: (e: Record<string, unknown>) => store.insert(e as never),
      replace: async () => { throw { status: 412 }; },
    };
    const rl = new DurableRateLimiter(conflicting, () => 0, 3);
    const r = await rl.check("u", "submit", spec);
    expect(r.ok).toBe(true);
  });
});
