/**
 * Tests the libSQL/Turso adapter's logic against a **real SQL engine** without
 * needing Turso credentials or the `@libsql/client` package: a tiny fake client
 * implementing {@link LibsqlClientLike} backed by `bun:sqlite` runs the exact SQL
 * the adapter emits (CREATE / INSERT … ON CONFLICT / UPDATE … RETURNING / SELECT / DELETE / LIKE
 * ESCAPE). It uses `bun:sqlite`, so it runs via `bun test`, not vitest.
 *
 *   bun test test/storage-libsql.bun.test.ts
 */
import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runStorageContractTests } from "./storage-contract.ts";
import {
  createLibsqlStorage,
  type LibsqlClientLike,
  type LibsqlLinksStorage,
} from "../src/storage/libsql.ts";

/** A `@libsql/client`-shaped client backed by an in-memory `bun:sqlite` database. */
function fakeLibsqlClient(): LibsqlClientLike {
  const db = new Database(":memory:");
  return {
    async execute(stmt) {
      if (typeof stmt === "string") {
        db.run(stmt);
        return { rows: [] };
      }
      const { sql, args } = stmt;
      if (/^\s*select|\breturning\b/i.test(sql)) {
        return { rows: db.query(sql).all(...(args as never[])) as Array<Record<string, unknown>> };
      }
      db.query(sql).run(...(args as never[]));
      return { rows: [] };
    },
    close() {
      db.close();
    },
  };
}

const open: LibsqlLinksStorage[] = [];
const make = (): LibsqlLinksStorage => {
  const storage = createLibsqlStorage({ client: fakeLibsqlClient() });
  open.push(storage);
  return storage;
};

afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

// `bun test` rewrites the suite's `vitest` imports to `bun:test`.
runStorageContractTests("libsql (bun:sqlite-backed fake client)", make, { compareAndSwap: true });

describe("libsql storage (bun:sqlite-backed fake client)", () => {
  test("returns null for a missing key", async () => {
    expect(await make().getItem("lnk/t/acme/missing")).toBeNull();
  });

  test("round-trips an object value", async () => {
    const storage = make();
    const value = { url: "https://x.example", rateLimit: 42, tags: ["a", "b"], nested: { x: 1 } };
    await storage.setItem("lnk/t/acme/links/lnk_1", value);
    expect(await storage.getItem("lnk/t/acme/links/lnk_1")).toEqual(value);
  });

  test("overwrites an existing key (ON CONFLICT)", async () => {
    const storage = make();
    await storage.setItem("lnk/t/acme/k", { v: 1 });
    await storage.setItem("lnk/t/acme/k", { v: 2 });
    expect(await storage.getItem("lnk/t/acme/k")).toEqual({ v: 2 });
  });

  test("removeItem deletes a key; missing is a no-op", async () => {
    const storage = make();
    await storage.setItem("lnk/t/acme/k", { v: 1 });
    await storage.removeItem("lnk/t/acme/k");
    expect(await storage.getItem("lnk/t/acme/k")).toBeNull();
    await storage.removeItem("lnk/t/acme/nope");
  });

  test("getKeys lists + isolates by prefix (LIKE ESCAPE)", async () => {
    const storage = make();
    await storage.setItem("lnk/t/app1/a", 1);
    await storage.setItem("lnk/t/app1/b", 2);
    await storage.setItem("lnk/t/app2/c", 3);
    expect((await storage.getKeys("lnk/t/app1/")).sort()).toEqual(["lnk/t/app1/a", "lnk/t/app1/b"]);
    expect(await storage.getKeys("lnk/t/app2/")).toEqual(["lnk/t/app2/c"]);
    expect(await storage.getKeys("lnk/none/")).toEqual([]);
  });

  test("compareAndSwap only writes over the exact value it read", async () => {
    const storage = make();
    await storage.setItem("lnk/cas", { a: 1, b: [1] });
    expect(
      await storage.compareAndSwap({ key: "lnk/cas", expected: { b: [1], a: 1 }, next: { a: 2 } }),
    ).toBe(true);
    expect(await storage.compareAndSwap({ key: "lnk/cas", expected: { a: 1 }, next: 0 })).toBe(
      false,
    );
    expect(await storage.compareAndSwap({ key: "lnk/missing", expected: 1, next: 2 })).toBe(false);
    expect(await storage.getItem("lnk/cas")).toEqual({ a: 2 });
  });

  test("rejects unsafe table names", () => {
    expect(() => createLibsqlStorage({ client: fakeLibsqlClient(), table: "bad; drop" })).toThrow();
  });

  test("requires a client or url", () => {
    const storage = createLibsqlStorage({});
    expect(storage.getItem("k")).rejects.toThrow(/client.*or.*url/i);
  });
});
