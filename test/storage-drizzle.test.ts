import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableName } from "drizzle-orm";
import { afterEach, describe, expect, test, vi } from "vitest";
import { text } from "drizzle-orm/pg-core";
import { pgLinksTable } from "../src/drizzle/pg.ts";
import { mysqlLinksTable } from "../src/drizzle/mysql.ts";
import { sqliteLinksTable } from "../src/drizzle/sqlite.ts";
import { createDrizzleStorage } from "../src/storage/drizzle.ts";
import { isCompareAndSwap, isWatchable } from "../src/storage/contract.ts";
import { runStorageContractTests } from "./storage-contract.ts";

// Every test boots a fresh in-process PGlite (WASM Postgres), which can take
// seconds on a loaded host — allow more than the default 5s.
vi.setConfig({ testTimeout: 30_000 });

/**
 * Run the shared LinksStorage contract suite against the Drizzle adapter
 * over a Postgres Drizzle database (in-process PGlite). Each run gets a fresh
 * DB; the table is created by the test (mirroring a consumer's migration — the
 * adapter itself issues no DDL). This also proves a real Drizzle db satisfies
 * the adapter's structural `db` type.
 */
runStorageContractTests(
  "drizzle (pg/pglite)",
  async () => {
    const client = new PGlite();
    await client.exec(`CREATE TABLE links_kv (key text PRIMARY KEY, value jsonb NOT NULL)`);
    const db = drizzle(client);
    return createDrizzleStorage({ db, table: pgLinksTable("links_kv") });
  },
  { compareAndSwap: true },
);

describe("createDrizzleStorage (pg/pglite)", () => {
  test("round-trips nested values and isolates by prefix", async () => {
    const client = new PGlite();
    await client.exec(`CREATE TABLE kv (key text PRIMARY KEY, value jsonb NOT NULL)`);
    const storage = createDrizzleStorage({ db: drizzle(client), table: pgLinksTable("kv") });

    const value = { url: "https://x.example", rateLimit: 42, nested: { tags: ["a", "b"] } };
    await storage.setItem("lnk/t/acme/links/lnk_1", value);
    expect(await storage.getItem("lnk/t/acme/links/lnk_1")).toEqual(value);

    await storage.setItem("lnk/t/app1/a", { v: 1 });
    await storage.setItem("lnk/t/app2/b", { v: 2 });
    expect(await storage.getKeys("lnk/t/app1/")).toEqual(["lnk/t/app1/a"]);
  });

  test("setItem upserts (second write wins)", async () => {
    const client = new PGlite();
    await client.exec(`CREATE TABLE kv (key text PRIMARY KEY, value jsonb NOT NULL)`);
    const storage = createDrizzleStorage({ db: drizzle(client), table: pgLinksTable("kv") });
    await storage.setItem("k", { n: 1 });
    await storage.setItem("k", { n: 2 });
    expect(await storage.getItem("k")).toEqual({ n: 2 });
  });

  test("compareAndSwap matches jsonb structurally and rejects a stale expected", async () => {
    const client = new PGlite();
    await client.exec(`CREATE TABLE kv (key text PRIMARY KEY, value jsonb NOT NULL)`);
    const storage = createDrizzleStorage({ db: drizzle(client), table: pgLinksTable("kv") });
    if (!isCompareAndSwap(storage)) throw new Error("expected compareAndSwap");
    await storage.setItem("lnk/cas", { a: 1, b: "x" });
    expect(
      await storage.compareAndSwap<unknown>({
        key: "lnk/cas",
        expected: { b: "x", a: 1 },
        next: 2,
      }),
    ).toBe(true);
    expect(await storage.compareAndSwap({ key: "lnk/cas", expected: 1, next: 3 })).toBe(false);
    expect(await storage.getItem("lnk/cas")).toBe(2);
    expect(await storage.compareAndSwap({ key: "lnk/none", expected: 2, next: 3 })).toBe(false);
  });

  test("a MySQL table yields a storage without compareAndSwap", () => {
    const storage = createDrizzleStorage({ db: {}, table: mysqlLinksTable("kv") });
    expect(isCompareAndSwap(storage)).toBe(false);
    const sqlite = createDrizzleStorage({ db: {}, table: sqliteLinksTable("kv") });
    expect(isCompareAndSwap(sqlite)).toBe(true);
  });

  test("plain storage is not watchable (watch is composed via withWatch)", async () => {
    const client = new PGlite();
    await client.exec(`CREATE TABLE kv (key text PRIMARY KEY, value jsonb NOT NULL)`);
    const storage = createDrizzleStorage({ db: drizzle(client), table: pgLinksTable("kv") });
    expect(isWatchable(storage)).toBe(false);
  });
});

describe("table factories — shape", () => {
  afterEach(() => vi.restoreAllMocks());

  test("all three dialects expose key + value columns", () => {
    for (const t of [pgLinksTable("kv"), mysqlLinksTable("kv"), sqliteLinksTable("kv")]) {
      expect(t.key).toBeDefined();
      expect(t.value).toBeDefined();
    }
  });

  test("the table name defaults to xtandard_links_kv", () => {
    expect(getTableName(pgLinksTable())).toBe("xtandard_links_kv");
    expect(getTableName(mysqlLinksTable())).toBe("xtandard_links_kv");
    expect(getTableName(sqliteLinksTable())).toBe("xtandard_links_kv");
  });

  test("extraColumns merges additional columns onto the table", () => {
    const t = pgLinksTable("kv", { extraColumns: () => ({ tenantId: text("tenant_id") }) });
    expect((t as unknown as Record<string, unknown>).tenantId).toBeDefined();
    // Accepting extraIndexes must not throw (Drizzle invokes it lazily at SQL-gen).
    expect(() => pgLinksTable("kv", { extraIndexes: () => [] })).not.toThrow();
  });
});
