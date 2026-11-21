import { PGlite } from "@electric-sql/pglite";
import { afterAll, describe, expect, test, vi } from "vitest";
import { createPostgresStorage, type PostgresLinksStorage } from "../src/storage/postgres.ts";
import { runStorageContractTests } from "./storage-contract.ts";

// Every test boots a fresh in-process PGlite (WASM Postgres), which can take
// seconds on a loaded host — allow more than the default 5s.
vi.setConfig({ testTimeout: 30_000 });

/**
 * The kit conformance suite against the wrapped Postgres driver, backed by an
 * in-process PGlite instance so no server is required. Each invocation gets a
 * FRESH PGlite for isolation.
 */
let pglite = new PGlite();
runStorageContractTests(
  "postgres (pglite)",
  () => createPostgresStorage({ client: (pglite = new PGlite()) }),
  {
    t: { describe, test, expect },
    capabilities: { compareAndSwap: true, watch: false },
    timeout: 60_000,
    seedLegacy: async (storage, key, raw) => {
      await storage.getKeys(""); // run the DDL
      await pglite.query(`INSERT INTO xtandard_links_kv (key, value) VALUES ($1, $2::jsonb)`, [
        key,
        raw,
      ]);
    },
  },
);

describe("createPostgresStorage (links defaults)", () => {
  test('the table defaults to "xtandard_links_kv" (rows from earlier releases read back)', async () => {
    const client = new PGlite();
    await client.exec(
      `CREATE TABLE xtandard_links_kv (key text PRIMARY KEY, value jsonb NOT NULL);
       INSERT INTO xtandard_links_kv VALUES ('lnk/t/acme/meta', '{"name":"Acme","id":"acme"}');`,
    );
    const storage = createPostgresStorage({ client });
    expect(await storage.getItem("lnk/t/acme/meta")).toEqual({ id: "acme", name: "Acme" });
    expect(await storage.getKeys("lnk/")).toEqual(["lnk/t/acme/meta"]);
  });

  test("an explicit table is honoured", async () => {
    const client = new PGlite();
    await createPostgresStorage({ client, table: "custom_kv" }).setItem("lnk/k", { v: 1 });
    const { rows } = await client.query<{ key: string }>(`SELECT key FROM custom_kv`);
    expect(rows).toEqual([{ key: "lnk/k" }]);
  });

  test("close() with a borrowed client is a safe no-op", async () => {
    const s = createPostgresStorage({ client: new PGlite() });
    await expect(s.close()).resolves.toBeUndefined();
  });
});

/**
 * Optional live-server suite (compare-and-swap across a real connection pool,
 * where concurrent claims genuinely race) — one fresh table per test. Runs only
 * when `POSTGRES_URL` is set. Cleans up after itself.
 */
describe.skipIf(!process.env.POSTGRES_URL)("createPostgresStorage (live)", () => {
  const runId = Date.now();
  let counter = 0;
  const opened: Array<{ storage: PostgresLinksStorage; table: string }> = [];

  runStorageContractTests(
    "postgres (live)",
    () => {
      const table = `xtandard_links_contract_${runId}_${counter++}`;
      const storage = createPostgresStorage({ connectionString: process.env.POSTGRES_URL, table });
      opened.push({ storage, table });
      return storage;
    },
    {
      t: { describe, test, expect },
      capabilities: { compareAndSwap: true, watch: false },
      timeout: 30_000,
    },
  );

  afterAll(async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
    for (const { storage, table } of opened) {
      await storage.close();
      await pool.query(`DROP TABLE IF EXISTS ${table}`);
    }
    await pool.end();
  });
});
