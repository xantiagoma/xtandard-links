import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createRedisStorage, type RedisLinksStorage } from "../src/storage/redis.ts";
import { isCompareAndSwap, isWatchable } from "../src/storage/contract.ts";
import { runStorageContractTests } from "./storage-contract.ts";

const REDIS_URL = process.env.REDIS_URL;

/** Keyspace notifications are off by default (e.g. a CI redis service); enable them. */
async function enableKeyspaceEvents(url: string): Promise<void> {
  const { createClient } = (await import("redis")) as unknown as {
    createClient: (opts: Record<string, unknown>) => {
      connect(): Promise<unknown>;
      configSet(p: string, v: string): Promise<unknown>;
      quit(): Promise<unknown>;
    };
  };
  const cfg = createClient({ url });
  await cfg.connect();
  await cfg.configSet("notify-keyspace-events", "KEA");
  await cfg.quit();
}

/**
 * Live conformance suite — runs only when `REDIS_URL` is set, so CI without a
 * Redis server simply skips it. Every `makeStorage` call gets a unique key
 * prefix so each contract test starts empty and never collides with real data;
 * everything is cleaned up and closed in `afterAll`. Compare-and-swap runs
 * through the Lua script; watch through keyspace notifications.
 */
describe.skipIf(!REDIS_URL)("redis storage (live conformance)", () => {
  const runId = `xtandard-links-test:${Date.now()}`;
  let counter = 0;
  const opened: RedisLinksStorage[] = [];

  beforeAll(() => enableKeyspaceEvents(REDIS_URL!));

  runStorageContractTests(
    "redis",
    () => {
      const storage = createRedisStorage({ url: REDIS_URL, prefix: `${runId}:${counter++}` });
      opened.push(storage);
      return storage;
    },
    { compareAndSwap: true, watch: { settleMs: 300 } },
  );

  afterAll(async () => {
    for (const storage of opened) {
      for (const key of await storage.getKeys("")) await storage.removeItem(key);
      await storage.close();
    }
  });
});

/** Adapter-specific live behaviour (prefix stripping, watch, glob escaping). */
describe.skipIf(!REDIS_URL)("createRedisStorage (live)", () => {
  const prefix = `xtandard-links-live:${Date.now()}`;
  let storage: RedisLinksStorage;

  beforeAll(() => {
    storage = createRedisStorage({ url: REDIS_URL, prefix });
  });

  afterAll(async () => {
    for (const key of await storage.getKeys("")) await storage.removeItem(key);
    await storage.close();
  });

  test("returns null for a missing key", async () => {
    expect(await storage.getItem("lnk/t/acme/missing")).toBeNull();
  });

  test("round-trips an object value", async () => {
    const value = { url: "https://x.example", eventTypes: ["a", "b"], nested: { x: 1 } };
    await storage.setItem("lnk/t/acme/links/lnk_1", value);
    expect(await storage.getItem("lnk/t/acme/links/lnk_1")).toEqual(value);
  });

  test("removeItem deletes a key", async () => {
    await storage.setItem("lnk/t/acme/k", { v: 1 });
    await storage.removeItem("lnk/t/acme/k");
    expect(await storage.getItem("lnk/t/acme/k")).toBeNull();
  });

  test("getKeys lists matching keys with the prefix stripped", async () => {
    await storage.setItem("lnk/t/acme/a", { v: 1 });
    await storage.setItem("lnk/t/acme/b", { v: 2 });
    const keys = await storage.getKeys("lnk/t/acme/");
    expect(keys).toContain("lnk/t/acme/a");
    expect(keys).toContain("lnk/t/acme/b");
    for (const k of keys) expect(k.startsWith(prefix)).toBe(false);
  });

  test("getKeys isolates by prefix", async () => {
    await storage.setItem("lnk/t/iso1/a", { v: 1 });
    await storage.setItem("lnk/t/iso2/b", { v: 2 });
    expect(await storage.getKeys("lnk/t/iso1/")).toEqual(["lnk/t/iso1/a"]);
    expect(await storage.getKeys("lnk/t/iso2/")).toEqual(["lnk/t/iso2/b"]);
  });

  test("getKeys treats glob metacharacters in the prefix literally", async () => {
    await storage.setItem("lnk/s/h/a*b", 1);
    await storage.setItem("lnk/s/h/aXb", 2);
    await storage.setItem("lnk/s/h/a?c", 3);
    expect(await storage.getKeys("lnk/s/h/a*")).toEqual(["lnk/s/h/a*b"]);
    expect(await storage.getKeys("lnk/s/h/a?")).toEqual(["lnk/s/h/a?c"]);
  });

  test("compareAndSwap matches structurally (key order is irrelevant)", async () => {
    await storage.setItem("lnk/cas/order", { a: 1, b: [1, 2] });
    expect(
      await storage.compareAndSwap({
        key: "lnk/cas/order",
        expected: { b: [1, 2], a: 1 },
        next: { a: 2 },
      }),
    ).toBe(true);
    expect(await storage.getItem("lnk/cas/order")).toEqual({ a: 2 });
  });

  test("watch delivers update and remove events (keyspace notifications)", async () => {
    await enableKeyspaceEvents(REDIS_URL!);

    const events: { type: string; key: string }[] = [];
    const off = await storage.watch("lnk/watch/", (e) => events.push(e));
    await storage.setItem("lnk/watch/e/k", { v: 1 });
    await storage.removeItem("lnk/watch/e/k");
    // Give pub/sub a moment to deliver.
    await new Promise((r) => setTimeout(r, 500));
    off();
    expect(events.some((e) => e.type === "update" && e.key === "lnk/watch/e/k")).toBe(true);
    expect(events.some((e) => e.type === "remove" && e.key === "lnk/watch/e/k")).toBe(true);
  });
});

describe.skipIf(!REDIS_URL)("createRedisStorage — borrowed client", () => {
  test("close() is a no-op for a client the adapter did not create", async () => {
    const { createClient } = (await import("redis")) as unknown as {
      createClient: (opts: Record<string, unknown>) => {
        connect(): Promise<unknown>;
        isOpen: boolean;
        quit(): Promise<unknown>;
      };
    };
    const client = createClient({ url: REDIS_URL });
    await client.connect();
    const storage = createRedisStorage({
      client: client as never,
      prefix: `borrowed:${Date.now()}`,
    });
    await storage.setItem("lnk/b/k", { v: 1 });
    expect(await storage.getItem("lnk/b/k")).toEqual({ v: 1 });
    await storage.removeItem("lnk/b/k");
    // close() must NOT disconnect a borrowed client.
    await storage.close();
    expect(client.isOpen).toBe(true);
    // clean up the client ourselves.
    await client.quit();
  });

  test("onError handler is observable (attaches without throwing)", () => {
    const errors: unknown[] = [];
    const storage = createRedisStorage({
      url: "redis://localhost:6399",
      onError: (e) => errors.push(e),
    });
    expect(typeof storage.close).toBe("function");
  });
});

/**
 * A fake node-redis client (Map-backed) recording `eval` calls — enough to
 * verify the SCAN pattern escaping and the CAS script arguments without a server.
 */
function fakeClient() {
  const strings = new Map<string, string>();
  const scans: string[] = [];
  const evals: Array<{ script: string; keys?: string[]; arguments?: string[] }> = [];
  const client = {
    isOpen: true,
    on: () => client,
    connect: async () => client,
    quit: async () => undefined,
    get: async (key: string) => strings.get(key) ?? null,
    set: async (key: string, value: string) => {
      strings.set(key, value);
    },
    del: async (key: string) => {
      strings.delete(key);
    },
    // A JS stand-in for the two Lua scripts, keyed off the arguments they take.
    eval: async (script: string, options: { keys?: string[]; arguments?: string[] } = {}) => {
      evals.push({ script, ...options });
      const key = options.keys?.[0] ?? "";
      const args = options.arguments;
      if (!args) return strings.get(key) ?? null; // read-raw script
      const [mode, next, expectedRaw] = args;
      const current = strings.get(key);
      if (mode === "0" ? current !== undefined : current !== expectedRaw) return 0;
      strings.set(key, next!);
      return 1;
    },
    scanIterator: async function* (options?: { MATCH?: string }) {
      scans.push(options?.MATCH ?? "*");
      for (const key of strings.keys()) yield key;
    },
    duplicate: () => client,
    pSubscribe: async () => undefined,
    disconnect: async () => undefined,
  };
  return { client: client as never, strings, scans, evals };
}

describe("createRedisStorage (fake client)", () => {
  test("getKeys escapes glob metacharacters in the SCAN MATCH pattern", async () => {
    const { client, scans } = fakeClient();
    const storage = createRedisStorage({ client, prefix: "ns" });
    await storage.getKeys("lnk/s/h/a*b?[c]\\");
    expect(scans).toEqual(["ns:lnk/s/h/a\\*b\\?\\[c\\]\\\\*"]);
  });

  test("compareAndSwap claims an absent key once, under the namespace", async () => {
    const { client, strings, evals } = fakeClient();
    const storage = createRedisStorage({ client, prefix: "ns" });
    expect(
      await storage.compareAndSwap({ key: "lnk/s/h/x", expected: null, next: { id: 1 } }),
    ).toBe(true);
    expect(
      await storage.compareAndSwap({ key: "lnk/s/h/x", expected: null, next: { id: 2 } }),
    ).toBe(false);
    expect(strings.get("ns:lnk/s/h/x")).toBe('{"id":1}');
    expect(evals.every((e) => e.keys?.[0] === "ns:lnk/s/h/x")).toBe(true);
  });

  test("compareAndSwap guards the write with the exact raw value it read", async () => {
    const { client, strings, evals } = fakeClient();
    const storage = createRedisStorage({ client });
    strings.set("k", '{"b":2,"a":1}');
    expect(
      await storage.compareAndSwap<unknown>({ key: "k", expected: { a: 1, b: 2 }, next: 3 }),
    ).toBe(true);
    expect(evals.at(-1)?.arguments).toEqual(["1", "3", '{"b":2,"a":1}']);
    expect(await storage.compareAndSwap({ key: "k", expected: 4, next: 5 })).toBe(false);
    expect(await storage.compareAndSwap({ key: "missing", expected: 4, next: 5 })).toBe(false);
    expect(strings.get("k")).toBe("3");
  });
});

/**
 * Type/shape checks that need no live server: a created adapter exposes the
 * full {@link RedisLinksStorage} surface (the contract methods plus watch,
 * compareAndSwap, and close).
 */
describe("createRedisStorage shape", () => {
  test("exposes the LinksStorage + watch + compareAndSwap + close surface without connecting", () => {
    const storage = createRedisStorage({ url: "redis://localhost:6379", prefix: "x" });
    expect(typeof storage.getItem).toBe("function");
    expect(typeof storage.setItem).toBe("function");
    expect(typeof storage.removeItem).toBe("function");
    expect(typeof storage.getKeys).toBe("function");
    expect(typeof storage.watch).toBe("function");
    expect(typeof storage.close).toBe("function");
    expect(isWatchable(storage)).toBe(true);
    expect(isCompareAndSwap(storage)).toBe(true);
  });

  test("close() before any connection is a safe no-op", async () => {
    const storage = createRedisStorage({ url: "redis://localhost:6379" });
    await expect(storage.close()).resolves.toBeUndefined();
  });

  test("getKeys handles scanIterator yielding batched arrays (node-redis v5)", async () => {
    // A fake client whose scanIterator yields an array of keys in one step, with
    // the namespace prefix attached, to exercise the array-batch branch.
    const fake = {
      isOpen: true,
      on() {},
      async connect() {},
      async quit() {},
      async get() {
        return null;
      },
      async set() {},
      async del() {},
      async eval() {
        return [];
      },
      // eslint-disable-next-line require-yield
      async *scanIterator() {
        yield ["x:lnk/a", "x:lnk/b"];
      },
      duplicate() {
        return fake;
      },
      async pSubscribe() {},
      async disconnect() {},
    };
    const storage = createRedisStorage({ client: fake as never, prefix: "x" });
    const keys = await storage.getKeys("lnk/");
    expect(keys.sort()).toEqual(["lnk/a", "lnk/b"]);
  });
});
