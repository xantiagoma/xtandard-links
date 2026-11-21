import { describe, expect, test } from "vitest";
import { createCloudflareKvStorage, type KVNamespaceLike } from "../src/storage/cloudflare-kv.ts";
import { runStorageContractTests } from "./storage-contract.ts";

/**
 * Minimal in-memory stand-in for a Workers `KVNamespace` binding — enough to
 * exercise the adapter's get/put/delete/list-pagination logic without Miniflare.
 * `list` pages two keys at a time so the adapter's cursor loop is covered.
 */
function fakeKv(): KVNamespaceLike {
  const store = new Map<string, string>();
  return {
    async get(key) {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    async list(options) {
      const prefix = options?.prefix ?? "";
      const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = options?.cursor ? Number(options.cursor) : 0;
      const pageSize = 2;
      const page = all.slice(start, start + pageSize);
      const next = start + pageSize;
      const list_complete = next >= all.length;
      return {
        keys: page.map((name) => ({ name })),
        list_complete,
        ...(list_complete ? {} : { cursor: String(next) }),
      };
    },
  };
}

runStorageContractTests("cloudflare-kv (fake binding)", () =>
  createCloudflareKvStorage({ namespace: fakeKv() }),
);

describe("cloudflare-kv — prefix namespacing", () => {
  test("stores under the configured prefix and strips it from getKeys", async () => {
    const kv = fakeKv();
    const storage = createCloudflareKvStorage({ namespace: kv, prefix: "prod" });
    await storage.setItem("lnk/t/acme/ext/k", "msg_1");

    // The underlying binding sees the namespaced key…
    expect(await kv.get("prod:lnk/t/acme/ext/k")).toBe('"msg_1"');
    // …but callers see the bare key.
    expect(await storage.getKeys("lnk/")).toEqual(["lnk/t/acme/ext/k"]);
    expect(await storage.getItem("lnk/t/acme/ext/k")).toBe("msg_1");
  });

  test("getKeys pages through the cursor across many keys", async () => {
    const storage = createCloudflareKvStorage({ namespace: fakeKv() });
    for (let i = 0; i < 7; i++) await storage.setItem(`lnk/t/acme/links/lnk_${i}`, i);
    const keys = await storage.getKeys("lnk/t/acme/links/");
    expect(keys).toHaveLength(7);
  });
});
