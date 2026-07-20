import { describe, it, expect } from "vitest";
import { audit } from "../../api/src/shared/audit.js";
import { MemoryTableRepo } from "../../api/src/shared/tables.js";

const at = Date.parse("2026-07-10T12:00:00Z");

describe("audit", () => {
  it("writes a dated, queryable event row", async () => {
    const repo = new MemoryTableRepo();
    await audit(repo, { userId: "u1", event: "submit", route: "attempts/submit", meta: { scaled: 780 } }, () => at, () => 0.5);
    const rows = await repo.queryPartition("2026-07-10");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event).toBe("submit");
    expect(rows[0]!.userId).toBe("u1");
    expect(JSON.parse(rows[0]!.meta as string)).toEqual({ scaled: 780 });
  });

  it("is best-effort: a store failure never throws", async () => {
    const broken = { upsert: async () => { throw new Error("table down"); } } as unknown as MemoryTableRepo;
    await expect(audit(broken, { event: "x" })).resolves.toBeUndefined();
  });
});
