/**
 * Bun-native test for the SQLite adapter (`bun:sqlite` is unavailable under Node,
 * so this runs via `bun test`, not vitest — it is excluded from the vitest glob).
 *
 *   bun test test/storage-sqlite.bun.test.ts
 */
import { Database } from "bun:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createSqliteStorage, type SqliteLinksStorage } from "../src/storage/sqlite.ts";
import { runStorageContractTests } from "./storage-contract.ts";

const open: SqliteLinksStorage[] = [];
afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

let database = new Database(":memory:");
runStorageContractTests(
  "sqlite (bun:sqlite)",
  () => {
    database = new Database(":memory:");
    return createSqliteStorage({ database });
  },
  {
    t: { describe, test, expect },
    capabilities: { compareAndSwap: true, watch: false },
    seedLegacy: async (storage, key, raw) => {
      await storage.getKeys(""); // run the DDL
      database.query("INSERT INTO xtandard_links_kv (key, value) VALUES (?, ?)").run(key, raw);
    },
  },
);

describe("sqlite storage (links defaults)", () => {
  test('the table defaults to "xtandard_links_kv" (rows from earlier releases read back)', async () => {
    const db = new Database(":memory:");
    db.run("CREATE TABLE xtandard_links_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.query("INSERT INTO xtandard_links_kv VALUES (?, ?)").run(
      "lnk/t/acme/meta",
      JSON.stringify({ name: "Acme", id: "acme" }),
    );
    const storage = createSqliteStorage({ database: db });
    expect(await storage.getItem("lnk/t/acme/meta")).toEqual({ id: "acme", name: "Acme" });
    db.close();
  });

  test("compareAndSwap is atomic across two connections to one file", async () => {
    const path = join(tmpdir(), `links-sqlite-cas-${Date.now()}.db`);
    const a = createSqliteStorage({ path, table: "kv" });
    const b = createSqliteStorage({ path, table: "kv" });
    open.push(a, b);
    expect(await a.compareAndSwap({ key: "slug", expected: null, next: "a" })).toBe(true);
    expect(await b.compareAndSwap({ key: "slug", expected: null, next: "b" })).toBe(false);
    expect(await b.compareAndSwap({ key: "slug", expected: "a", next: "b" })).toBe(true);
    expect(await a.getItem("slug")).toBe("b");
  });

  test("persists across instances sharing a file", async () => {
    const path = join(tmpdir(), `links-sqlite-${Date.now()}.db`);
    const a = createSqliteStorage({ path });
    await a.setItem("lnk/t/acme/k", { v: 42 });
    a.close();
    const b = createSqliteStorage({ path });
    open.push(b);
    expect(await b.getItem("lnk/t/acme/k")).toEqual({ v: 42 });
  });
});
