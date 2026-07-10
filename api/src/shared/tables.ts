// ============================================================================
// Table Storage access (spec §III.2). One interface, two implementations:
//  - AzureTableRepo: managed identity (cloud) or connection string (local Azurite)
//  - MemoryTableRepo: in-process, used by tests (no emulator needed)
// PartitionKey=userId on Attempts is the privacy boundary — callers pass the
// authenticated userId; code never queries across users.
// ============================================================================
import { TableClient, odata, type TableEntity } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";

export type Entity = TableEntity<Record<string, unknown>>;

export interface TableRepo {
  upsert(entity: Entity): Promise<void>;
  get(partitionKey: string, rowKey: string): Promise<Entity | undefined>;
  /** All entities in a partition, optionally filtered to a RowKey prefix range. */
  queryPartition(partitionKey: string, rowKeyPrefix?: string): Promise<Entity[]>;
  remove(partitionKey: string, rowKey: string): Promise<void>;
}

// ---- Azure-backed ----------------------------------------------------------
export class AzureTableRepo implements TableRepo {
  constructor(private client: TableClient) {}

  static forTable(tableName: string): AzureTableRepo {
    const conn = process.env.TABLES_CONNECTION_STRING;
    const url = process.env.TABLES_ACCOUNT_URL;
    let client: TableClient;
    if (conn) {
      client = TableClient.fromConnectionString(conn, tableName, { allowInsecureConnection: true });
    } else if (url) {
      client = new TableClient(url, tableName, new DefaultAzureCredential());
    } else {
      throw new Error("Set TABLES_CONNECTION_STRING (local) or TABLES_ACCOUNT_URL (cloud).");
    }
    return new AzureTableRepo(client);
  }

  async upsert(entity: Entity): Promise<void> {
    await this.client.upsertEntity(entity, "Replace");
  }

  async get(partitionKey: string, rowKey: string): Promise<Entity | undefined> {
    try {
      return (await this.client.getEntity(partitionKey, rowKey)) as unknown as Entity;
    } catch (e: unknown) {
      if ((e as { statusCode?: number }).statusCode === 404) return undefined;
      throw e;
    }
  }

  async queryPartition(partitionKey: string, rowKeyPrefix?: string): Promise<Entity[]> {
    const filter = rowKeyPrefix
      ? odata`PartitionKey eq ${partitionKey} and RowKey ge ${rowKeyPrefix} and RowKey lt ${rowKeyPrefix + "~"}`
      : odata`PartitionKey eq ${partitionKey}`;
    const out: Entity[] = [];
    for await (const e of this.client.listEntities({ queryOptions: { filter } })) {
      out.push(e as unknown as Entity);
    }
    return out;
  }

  async remove(partitionKey: string, rowKey: string): Promise<void> {
    try {
      await this.client.deleteEntity(partitionKey, rowKey);
    } catch (e: unknown) {
      if ((e as { statusCode?: number }).statusCode !== 404) throw e;
    }
  }
}

// ---- In-memory (tests) -----------------------------------------------------
export class MemoryTableRepo implements TableRepo {
  private data = new Map<string, Map<string, Entity>>();

  async upsert(entity: Entity): Promise<void> {
    const pk = entity.partitionKey;
    if (!this.data.has(pk)) this.data.set(pk, new Map());
    this.data.get(pk)!.set(entity.rowKey, structuredClone(entity));
  }

  async get(partitionKey: string, rowKey: string): Promise<Entity | undefined> {
    const e = this.data.get(partitionKey)?.get(rowKey);
    return e ? structuredClone(e) : undefined;
  }

  async queryPartition(partitionKey: string, rowKeyPrefix?: string): Promise<Entity[]> {
    const part = this.data.get(partitionKey);
    if (!part) return [];
    const out: Entity[] = [];
    for (const e of part.values()) {
      if (rowKeyPrefix && !e.rowKey.startsWith(rowKeyPrefix)) continue;
      out.push(structuredClone(e));
    }
    return out;
  }

  async remove(partitionKey: string, rowKey: string): Promise<void> {
    this.data.get(partitionKey)?.delete(rowKey);
  }
}

/** Inverted-ticks RowKey component so newest sorts first (spec §III.3). */
const MAX_TICKS = 3155378975999999999n; // DateTime.MaxValue ticks
export function invTicks(iso: string): string {
  const ms = BigInt(Date.parse(iso));
  const ticks = MAX_TICKS - ms * 10000n;
  return ticks.toString().padStart(19, "0");
}
