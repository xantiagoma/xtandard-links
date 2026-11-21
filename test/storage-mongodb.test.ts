import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MongoClient } from "mongodb";
import { createMongoStorage, type MongoLinksStorage } from "../src/storage/mongodb.ts";
import { runStorageContractTests } from "./storage-contract.ts";

const MONGO_URL = process.env.MONGO_URL ?? "mongodb://localhost:27117";

// Detect a reachable MongoDB up front (short timeout) so CI without a server
// simply skips the live suite instead of hanging on connection attempts.
let available = false;
{
  const probe = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 1500 });
  try {
    await probe.connect();
    await probe.db("admin").command({ ping: 1 });
    available = true;
  } catch {
    available = false;
  } finally {
    await probe.close().catch(() => {});
  }
}

// A unique database per run keeps concurrent/repeated runs isolated; it is
// dropped in afterAll.
const dbName = `links_test_${Date.now()}`;

// Live round-trips are sequential (e.g. 120 writes in "lists many keys"), so allow
// more than the default 5s on a slow or loaded host.
describe.skipIf(!available)("createMongoStorage (live)", { timeout: 30_000 }, () => {
  // Fresh collection per contract test, so the shared suite starts empty.
  let counter = 0;
  const makers: MongoLinksStorage[] = [];

  runStorageContractTests(
    "mongodb",
    () => {
      const storage = createMongoStorage({
        url: MONGO_URL,
        dbName,
        collectionName: `kv_${counter++}`,
      });
      makers.push(storage);
      return storage;
    },
    { compareAndSwap: true },
  );

  describe("mongodb specifics", () => {
    let storage: MongoLinksStorage;

    beforeAll(() => {
      storage = createMongoStorage({ url: MONGO_URL, dbName, collectionName: "specifics" });
      makers.push(storage);
    });

    test("round-trips a nested object value directly (no JSON wrapping)", async () => {
      const value = { url: "https://x.example", tags: ["a", "b"], nested: { x: { y: 1 } } };
      await storage.setItem("lnk/t/acme/obj", value);
      expect(await storage.getItem("lnk/t/acme/obj")).toEqual(value);
    });

    test("returns null for a missing key", async () => {
      expect(await storage.getItem("lnk/t/acme/does-not-exist")).toBeNull();
    });

    test("getKeys isolates by prefix", async () => {
      await storage.setItem("lnk/t/iso1/a", { v: 1 });
      await storage.setItem("lnk/t/iso2/b", { v: 2 });
      expect(await storage.getKeys("lnk/t/iso1/")).toEqual(["lnk/t/iso1/a"]);
      expect(await storage.getKeys("lnk/t/iso2/")).toEqual(["lnk/t/iso2/b"]);
    });

    test("getKeys returns nested keys under a prefix", async () => {
      await storage.setItem("lnk/t/nest/links/lnk_1", { v: 1 });
      await storage.setItem("lnk/t/nest/links/lnk_2", { v: 2 });
      await storage.setItem("lnk/t/nest/meta", { key: "nest" });
      const keys = await storage.getKeys("lnk/t/nest/");
      expect(keys.sort()).toEqual(
        ["lnk/t/nest/links/lnk_1", "lnk/t/nest/links/lnk_2", "lnk/t/nest/meta"].sort(),
      );
    });
  });

  afterAll(async () => {
    // Drop the throwaway database, then close every client this suite opened so
    // the vitest process can exit cleanly.
    const cleanup = new MongoClient(MONGO_URL);
    try {
      await cleanup.connect();
      await cleanup.db(dbName).dropDatabase();
    } finally {
      await cleanup.close();
    }
    for (const s of makers) await s.close();
  });
});

/**
 * Shape checks that need no live server: a created adapter exposes the full
 * {@link MongoLinksStorage} surface (the contract methods plus `close`) and
 * is not watchable.
 */
describe("createMongoStorage shape", () => {
  test("exposes the LinksStorage + compareAndSwap + close surface without connecting", () => {
    const storage = createMongoStorage({ url: "mongodb://localhost:27017" });
    expect(typeof storage.compareAndSwap).toBe("function");
    expect(typeof storage.getItem).toBe("function");
    expect(typeof storage.setItem).toBe("function");
    expect(typeof storage.removeItem).toBe("function");
    expect(typeof storage.getKeys).toBe("function");
    expect(typeof storage.close).toBe("function");
    expect("watch" in storage).toBe(false);
  });

  test("close() before any connection is a safe no-op", async () => {
    const storage = createMongoStorage({ url: "mongodb://localhost:27017" });
    await expect(storage.close()).resolves.toBeUndefined();
  });

  test("throws a clear error when neither client nor url is supplied", async () => {
    const storage = createMongoStorage({});
    await expect(storage.getItem("lnk/t/acme/k")).rejects.toThrow(
      /requires either a "client" or a "url"/,
    );
  });

  test("a connection failure is not cached: a later call retries", async () => {
    // Point at an unroutable port with a short server-selection timeout so this
    // fails fast. The first call rejects; the second must attempt to connect
    // again (the `connecting` promise is cleared on failure).
    const storage = createMongoStorage({
      url: "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=200&connectTimeoutMS=200",
    });
    await expect(storage.getItem("lnk/t/acme/k")).rejects.toBeTruthy();
    await expect(storage.getItem("lnk/t/acme/k")).rejects.toBeTruthy();
    await storage.close();
  });

  test("a pre-connected, borrowed client is not closed by close()", async () => {
    let closed = false;
    let _connectCalls = 0;
    const fakeCollection = {
      findOne: async () => null,
      updateOne: async () => ({}),
      deleteOne: async () => ({}),
      find: () => ({ project: () => ({ [Symbol.asyncIterator]: async function* () {} }) }),
    };
    const fakeClient = {
      async connect() {
        _connectCalls++;
      },
      db: () => ({ collection: () => fakeCollection }),
      async close() {
        closed = true;
      },
    };
    const storage = createMongoStorage({ client: fakeClient as never });
    expect(await storage.getItem("lnk/t/acme/k")).toBeNull();
    await storage.close();
    // close() is a no-op for borrowed clients.
    expect(closed).toBe(false);
  });

  test("an 'already connected' connect() error is swallowed", async () => {
    const fakeCollection = { findOne: async () => null };
    const fakeClient = {
      async connect() {
        throw new Error("MongoClient is already connected");
      },
      db: () => ({ collection: () => fakeCollection }),
      async close() {},
    };
    const storage = createMongoStorage({ client: fakeClient as never });
    expect(await storage.getItem("lnk/t/acme/k")).toBeNull();
  });

  test("compareAndSwap: a duplicate-key insert is a lost claim; other errors propagate", async () => {
    let insertError: unknown = Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    const fakeCollection = {
      insertOne: async () => {
        throw insertError;
      },
    };
    const fakeClient = {
      async connect() {},
      db: () => ({ collection: () => fakeCollection }),
      async close() {},
    };
    const storage = createMongoStorage({ client: fakeClient as never });
    expect(await storage.compareAndSwap({ key: "k", expected: null, next: 1 })).toBe(false);
    insertError = new Error("not primary");
    await expect(storage.compareAndSwap({ key: "k", expected: null, next: 1 })).rejects.toThrow(
      /not primary/,
    );
  });

  test("compareAndSwap filters the update on the exact value it read", async () => {
    const filters: unknown[] = [];
    const fakeCollection = {
      findOne: async () => ({ _id: "k", value: { b: 2, a: 1 } }),
      updateOne: async (filter: unknown) => {
        filters.push(filter);
        return { matchedCount: 1 };
      },
    };
    const fakeClient = {
      async connect() {},
      db: () => ({ collection: () => fakeCollection }),
      async close() {},
    };
    const storage = createMongoStorage({ client: fakeClient as never });
    // Deep-equal regardless of field order…
    expect(
      await storage.compareAndSwap<unknown>({ key: "k", expected: { a: 1, b: 2 }, next: 3 }),
    ).toBe(true);
    // …and the guard is the stored document as read (Mongo equality is order-sensitive).
    expect(filters).toEqual([{ _id: "k", value: { b: 2, a: 1 } }]);
    expect(await storage.compareAndSwap<unknown>({ key: "k", expected: { a: 9 }, next: 3 })).toBe(
      false,
    );
    expect(filters).toHaveLength(1);
  });

  test("a genuine connect() error propagates", async () => {
    const fakeClient = {
      async connect() {
        throw new Error("authentication failed");
      },
      db: () => ({ collection: () => ({}) }),
      async close() {},
    };
    const storage = createMongoStorage({ client: fakeClient as never });
    await expect(storage.getItem("lnk/t/acme/k")).rejects.toThrow(/authentication failed/);
  });
});
