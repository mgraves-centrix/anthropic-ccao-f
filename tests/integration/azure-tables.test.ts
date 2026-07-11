// Real Azure Table Storage path against Azurite. Opt-in (RUN_AZURE=1) so the
// default gate stays fast/deterministic; run via `npm run test:azure`.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { AzureTableRepo } from "../../api/src/shared/tables.js";

const RUN = process.env.RUN_AZURE === "1";
let proc: ChildProcess | undefined;

async function waitReachable(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = AzureTableRepo.forTable("Warmup");
      await r.ensureTable();
      return;
    } catch {
      await new Promise((res) => setTimeout(res, 400));
    }
  }
  throw new Error("Azurite did not become reachable");
}

describe.skipIf(!RUN)("AzureTableRepo against Azurite", () => {
  beforeAll(async () => {
    process.env.TABLES_CONNECTION_STRING = "UseDevelopmentStorage=true";
    proc = spawn("npx", ["azurite-table", "--location", ".azurite-test", "--silent"], { stdio: "ignore" });
    await waitReachable();
  }, 40000);

  afterAll(() => { proc?.kill(); });

  it("upsert / get / queryPartition (prefix) / remove round-trip", async () => {
    const repo = AzureTableRepo.forTable("ITTest");
    await repo.ensureTable();
    await repo.upsert({ partitionKey: "u1", rowKey: "CCAO-F|001", v: 1 });
    await repo.upsert({ partitionKey: "u1", rowKey: "CCDV-F|002", v: 2 });
    await repo.upsert({ partitionKey: "u2", rowKey: "CCAO-F|003", v: 3 });

    expect((await repo.get("u1", "CCAO-F|001"))?.v).toBe(1);
    expect(await repo.get("u1", "missing")).toBeUndefined();

    const all = await repo.queryPartition("u1");
    expect(all.length).toBe(2); // isolation: u2 not visible under u1

    const prefix = await repo.queryPartition("u1", "CCAO-F|");
    expect(prefix.length).toBe(1);

    await repo.remove("u1", "CCAO-F|001");
    expect(await repo.get("u1", "CCAO-F|001")).toBeUndefined();
  }, 30000);
});
