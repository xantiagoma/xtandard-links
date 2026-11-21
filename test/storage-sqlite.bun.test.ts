/**
 * Bun-native test for the SQLite adapter (`bun:sqlite` is unavailable under Node,
 * so this runs via `bun test`, not vitest — it is excluded from the vitest glob).
 *
 *   bun test test/storage-sqlite.bun.test.ts
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createSqliteStorage, type SqliteLinksStorage } from "../src/storage/sqlite.ts";
import { runStorageContractTests } from "./storage-contract.ts";

// `bun test` rewrites the suite's `vitest` imports to `bun:test`.
runStorageContractTests("sqlite (bun:sqlite)", () => createSqliteStorage({ table: "kv" }), {
  compareAndSwap: true,
});

let storage: SqliteLinksStorage;

beforeEach(() => {
  storage = createSqliteStorage({ table: "kv" }); // in-memory
});
afterEach(() => {
  storage.close();
});

describe("sqlite storage", () => {
  test("round-trips objects and returns null for missing keys", async () => {
    expect(await storage.getItem("nope")).toBeNull();
    await storage.setItem("lnk/t/acme/links/lnk_1", { url: "https://x.example", tags: ["a"] });
    expect(await storage.getItem("lnk/t/acme/links/lnk_1")).toEqual({
      url: "https://x.example",
      tags: ["a"],
    });
  });

  test("setItem overwrites", async () => {
    await storage.setItem("k", "one");
    await storage.setItem("k", "two");
    expect(await storage.getItem("k")).toBe("two");
  });

  test("removeItem deletes", async () => {
    await storage.setItem("k", 1);
    await storage.removeItem("k");
    expect(await storage.getItem("k")).toBeNull();
  });

  test("getKeys filters by prefix", async () => {
    await storage.setItem("lnk/a/x", 1);
    await storage.setItem("lnk/a/y", 2);
    await storage.setItem("lnk/b/z", 3);
    const keys = (await storage.getKeys("lnk/a/")).sort();
    expect(keys).toEqual(["lnk/a/x", "lnk/a/y"]);
  });

  test("getKeys treats LIKE wildcards in the prefix literally", async () => {
    await storage.setItem("lnk/s/h/50%25_off", 1);
    await storage.setItem("lnk/s/h/50X25Xoff", 2);
    expect(await storage.getKeys("lnk/s/h/50%25_")).toEqual(["lnk/s/h/50%25_off"]);
  });

  test("defaults the table to xtandard_links_kv", async () => {
    const { Database } = await import("bun:sqlite");
    const database = new Database(":memory:");
    await createSqliteStorage({ database }).setItem("k", 1);
    expect(database.query("SELECT value FROM xtandard_links_kv").all()).toEqual([{ value: "1" }]);
    database.close();
  });

  test("compareAndSwap is atomic across two connections to one file", async () => {
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const path = join(tmpdir(), `links-sqlite-cas-${Date.now()}.db`);
    const a = createSqliteStorage({ path, table: "kv" });
    const b = createSqliteStorage({ path, table: "kv" });
    expect(await a.compareAndSwap({ key: "slug", expected: null, next: "a" })).toBe(true);
    expect(await b.compareAndSwap({ key: "slug", expected: null, next: "b" })).toBe(false);
    expect(await b.compareAndSwap({ key: "slug", expected: "a", next: "b" })).toBe(true);
    expect(await a.getItem("slug")).toBe("b");
    a.close();
    b.close();
  });

  test("rejects unsafe table names", () => {
    expect(() => createSqliteStorage({ table: "bad; drop table" })).toThrow();
  });

  test("persists across instances sharing a file", async () => {
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const path = join(tmpdir(), `links-sqlite-${Date.now()}.db`);
    const a = createSqliteStorage({ path, table: "kv" });
    await a.setItem("k", { v: 42 });
    a.close();
    const b = createSqliteStorage({ path, table: "kv" });
    expect(await b.getItem("k")).toEqual({ v: 42 });
    b.close();
  });
});
