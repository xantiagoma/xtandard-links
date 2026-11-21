import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createPostgresStorage, type PostgresLinksStorage } from "../src/storage/postgres.ts";
import { runStorageContractTests } from "./storage-contract.ts";

// Every test boots a fresh in-process PGlite (WASM Postgres), which can take
// seconds on a loaded host — allow more than the default 5s.
vi.setConfig({ testTimeout: 30_000 });

/**
 * Run the shared {@link LinksStorage} contract suite against the Postgres
 * adapter, backed by an in-process PGlite instance so no server is required and
 * the tests always run. Each invocation gets a FRESH PGlite for isolation.
 */
runStorageContractTests(
  "postgres (pglite)",
  async () => createPostgresStorage({ client: new PGlite(), table: "kv" }),
  { compareAndSwap: true },
);

/** Adapter-specific behaviour against in-process PGlite. */
describe("createPostgresStorage (pglite)", () => {
  let storage: PostgresLinksStorage;

  beforeAll(() => {
    storage = createPostgresStorage({ client: new PGlite(), table: "links_test" });
  });

  test("round-trips a nested object value", async () => {
    const value = { url: "https://x.example", rateLimit: 42, tags: ["a", "b"], nested: { x: 1 } };
    await storage.setItem("lnk/t/acme/links/lnk_1", value);
    expect(await storage.getItem("lnk/t/acme/links/lnk_1")).toEqual(value);
  });

  test("returns null for a missing key", async () => {
    expect(await storage.getItem("lnk/t/acme/does-not-exist")).toBeNull();
  });

  test("isolates by prefix", async () => {
    await storage.setItem("lnk/t/app1/a", { v: 1 });
    await storage.setItem("lnk/t/app2/b", { v: 2 });
    expect(await storage.getKeys("lnk/t/app1/")).toEqual(["lnk/t/app1/a"]);
    expect(await storage.getKeys("lnk/t/app2/")).toEqual(["lnk/t/app2/b"]);
  });

  test("handles deeply nested keys", async () => {
    await storage.setItem("lnk/t/acme/attempts/dlv_1/0001", { v: 1 });
    expect(await storage.getItem("lnk/t/acme/attempts/dlv_1/0001")).toEqual({ v: 1 });
    expect(await storage.getKeys("lnk/t/acme/attempts/dlv_1/")).toContain(
      "lnk/t/acme/attempts/dlv_1/0001",
    );
  });

  test("defaults the table to xtandard_links_kv", async () => {
    const client = new PGlite();
    await createPostgresStorage({ client }).setItem("lnk/t/acme/k", 1);
    const { rows } = await client.query<{ value: unknown }>(
      "SELECT value FROM xtandard_links_kv WHERE key = 'lnk/t/acme/k'",
    );
    expect(rows).toEqual([{ value: 1 }]);
  });

  test("compareAndSwap compares jsonb structurally (key order is irrelevant)", async () => {
    const s = createPostgresStorage({ client: new PGlite(), table: "cas" });
    await s.setItem("lnk/cas", { a: 1, b: [1, 2] });
    expect(
      await s.compareAndSwap({ key: "lnk/cas", expected: { b: [1, 2], a: 1 }, next: { a: 2 } }),
    ).toBe(true);
    expect(await s.getItem("lnk/cas")).toEqual({ a: 2 });
  });

  test("two separate PGlite instances do not share data", async () => {
    const a = createPostgresStorage({ client: new PGlite(), table: "shared" });
    const b = createPostgresStorage({ client: new PGlite(), table: "shared" });
    await a.setItem("lnk/t/acme/only-in-a", { v: 1 });
    expect(await b.getItem("lnk/t/acme/only-in-a")).toBeNull();
    expect(await a.getItem("lnk/t/acme/only-in-a")).toEqual({ v: 1 });
  });
});

/** Type/shape checks that need no client connection. */
describe("createPostgresStorage shape", () => {
  test("rejects an unsafe table name", () => {
    expect(() =>
      createPostgresStorage({ client: new PGlite(), table: "bad; DROP TABLE x" }),
    ).toThrow();
  });

  test("close() with a borrowed client is a safe no-op", async () => {
    const s = createPostgresStorage({ client: new PGlite(), table: "kv" });
    await expect(s.close()).resolves.toBeUndefined();
  });
});

/**
 * Optional live-server suite — runs only when `POSTGRES_URL` is set, so CI
 * without a Postgres server simply skips it. Cleans up after itself.
 */
describe.skipIf(!process.env.POSTGRES_URL)("createPostgresStorage (live)", () => {
  const table = `xtandard_links_test_${Date.now()}`;
  let storage: PostgresLinksStorage;

  beforeAll(() => {
    storage = createPostgresStorage({ connectionString: process.env.POSTGRES_URL, table });
  });

  afterAll(async () => {
    for (const key of await storage.getKeys("")) await storage.removeItem(key);
    await storage.close();
  });

  test("round-trips an object value", async () => {
    const value = { url: "https://x.example", rateLimit: 42, nested: { x: 1 } };
    await storage.setItem("lnk/t/acme/links/lnk_1", value);
    expect(await storage.getItem("lnk/t/acme/links/lnk_1")).toEqual(value);
  });

  test("getKeys isolates by prefix", async () => {
    await storage.setItem("lnk/t/iso1/a", { v: 1 });
    await storage.setItem("lnk/t/iso2/b", { v: 2 });
    expect(await storage.getKeys("lnk/t/iso1/")).toEqual(["lnk/t/iso1/a"]);
    expect(await storage.getKeys("lnk/t/iso2/")).toEqual(["lnk/t/iso2/b"]);
  });
});

/**
 * Live conformance (incl. compare-and-swap across a real connection pool, where
 * concurrent claims genuinely race) — one fresh table per contract test,
 * dropped in `afterAll`. Runs only when `POSTGRES_URL` is set.
 */
describe.skipIf(!process.env.POSTGRES_URL)("createPostgresStorage (live conformance)", () => {
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
    { compareAndSwap: true },
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
