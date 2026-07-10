import { describe, it, expect } from "vitest";
import { MemoryTableRepo, invTicks, type Entity } from "../../api/src/shared/tables.js";

describe("MemoryTableRepo", () => {
  it("upsert/get/queryPartition/remove with rowKey prefix", async () => {
    const r = new MemoryTableRepo();
    const mk = (pk: string, rk: string): Entity => ({ partitionKey: pk, rowKey: rk, v: 1 });
    await r.upsert(mk("user1", "CCAO-F|001|a"));
    await r.upsert(mk("user1", "CCDV-F|002|b"));
    await r.upsert(mk("user2", "CCAO-F|003|c"));

    expect((await r.get("user1", "CCAO-F|001|a"))?.v).toBe(1);
    expect(await r.get("user1", "missing")).toBeUndefined();

    const all = await r.queryPartition("user1");
    expect(all).toHaveLength(2); // isolation: user2 not visible in user1's partition

    const ccaoOnly = await r.queryPartition("user1", "CCAO-F|");
    expect(ccaoOnly).toHaveLength(1);

    await r.remove("user1", "CCAO-F|001|a");
    expect(await r.get("user1", "CCAO-F|001|a")).toBeUndefined();
  });
});

describe("invTicks — newest sorts first", () => {
  it("earlier start → larger inverted key", () => {
    const older = invTicks("2026-01-01T00:00:00Z");
    const newer = invTicks("2026-07-01T00:00:00Z");
    expect(newer < older).toBe(true); // string compare: newer attempt sorts before older
    expect(older).toHaveLength(19);
  });
});
