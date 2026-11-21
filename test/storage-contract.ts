/**
 * Reusable conformance suite for the {@link LinksStorage} contract. Storage
 * adapters run the same battery of behavioural tests against their
 * implementation by calling {@link runStorageContractTests}.
 *
 * This file deliberately omits the `.test.ts` suffix so vitest does not pick it
 * up as a standalone suite — it only runs when imported by an adapter's test.
 *
 * @module
 */

import { describe, expect, test } from "vitest";
import { linkKey, linksPrefix, slugKey } from "../src/keys.ts";
import {
  isCompareAndSwap,
  isWatchable,
  type LinksStorage,
  type StorageChangeEvent,
} from "../src/storage/contract.ts";

/** A factory producing a fresh, empty storage for each test. */
export type MakeStorage = () => Promise<LinksStorage> | LinksStorage;

/** Optional capabilities a backend opts into testing. */
export interface StorageContractOptions {
  /** Run compare-and-swap semantics (requires `compareAndSwap`). */
  compareAndSwap?: boolean;
  /** Run watch semantics (requires `watch`). Delay (ms) to wait for notifications. */
  watch?: boolean | { settleMs: number };
  /**
   * The backend can store raw backslashes in keys. Default `true`; unstorage normalizes `\\` to
   * `:`. (The links key layout never produces one — segments are URI-encoded.)
   */
  backslashKeys?: boolean;
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Register a `describe(name, …)` block exercising the full {@link LinksStorage}
 * contract, plus opt-in capability semantics.
 */
export function runStorageContractTests(
  name: string,
  makeStorage: MakeStorage,
  options: StorageContractOptions = {},
): void {
  describe(`LinksStorage contract: ${name}`, () => {
    test("returns null for a missing key", async () => {
      const storage = await makeStorage();
      expect(await storage.getItem("lnk/t/acme/missing")).toBeNull();
    });

    test("round-trips an object value", async () => {
      const storage = await makeStorage();
      const value = { url: "https://x.example/a?b=1", tags: ["a", "b"], nested: { x: 1, y: null } };
      await storage.setItem(linkKey("acme", "lnk_1"), value);
      expect(await storage.getItem(linkKey("acme", "lnk_1"))).toEqual(value);
    });

    test("round-trips primitive values", async () => {
      const storage = await makeStorage();
      await storage.setItem("lnk/t/acme/ext/x", "lnk_1");
      expect(await storage.getItem("lnk/t/acme/ext/x")).toBe("lnk_1");
      await storage.setItem("lnk/n", 42);
      expect(await storage.getItem("lnk/n")).toBe(42);
    });

    test("round-trips arrays", async () => {
      const storage = await makeStorage();
      await storage.setItem("lnk/tenants", ["a", "b"]);
      expect(await storage.getItem("lnk/tenants")).toEqual(["a", "b"]);
    });

    test("overwrites an existing key", async () => {
      const storage = await makeStorage();
      await storage.setItem("lnk/t/acme/k", { v: 1 });
      await storage.setItem("lnk/t/acme/k", { v: 2 });
      expect(await storage.getItem("lnk/t/acme/k")).toEqual({ v: 2 });
    });

    test("removeItem deletes a key", async () => {
      const storage = await makeStorage();
      await storage.setItem("lnk/t/acme/k", { v: 1 });
      await storage.removeItem("lnk/t/acme/k");
      expect(await storage.getItem("lnk/t/acme/k")).toBeNull();
    });

    test("removeItem on a missing key is a no-op", async () => {
      const storage = await makeStorage();
      await expect(storage.removeItem("lnk/t/acme/nope")).resolves.toBeUndefined();
    });

    test("getKeys returns nested keys under a prefix", async () => {
      const storage = await makeStorage();
      await storage.setItem(linkKey("acme", "lnk_1"), { v: 1 });
      await storage.setItem(linkKey("acme", "lnk_2"), { v: 2 });
      await storage.setItem("lnk/t/acme/meta", { key: "acme" });
      const keys = await storage.getKeys("lnk/t/acme/");
      expect(keys.sort()).toEqual(
        [linkKey("acme", "lnk_1"), linkKey("acme", "lnk_2"), "lnk/t/acme/meta"].sort(),
      );
    });

    test("getKeys isolates by prefix (no sibling-prefix bleed)", async () => {
      const storage = await makeStorage();
      await storage.setItem("lnk/t/app1/a", { v: 1 });
      await storage.setItem("lnk/t/app10/b", { v: 2 });
      expect(await storage.getKeys("lnk/t/app1/")).toEqual(["lnk/t/app1/a"]);
      expect(await storage.getKeys("lnk/t/app10/")).toEqual(["lnk/t/app10/b"]);
    });

    test("getKeys returns an empty array when nothing matches", async () => {
      const storage = await makeStorage();
      await storage.setItem("lnk/t/acme/a", { v: 1 });
      expect(await storage.getKeys("lnk/t/other/")).toEqual([]);
    });

    test("keys with encoded characters (nested slugs, unicode) round-trip and list", async () => {
      const storage = await makeStorage();
      const k1 = slugKey("go.acme.com", "docs/intro");
      const k2 = slugKey("go.acme.com", "café-50%");
      await storage.setItem(k1, { tenant: "acme", id: "lnk_1" });
      await storage.setItem(k2, { tenant: "acme", id: "lnk_2" });
      expect(await storage.getItem(k1)).toEqual({ tenant: "acme", id: "lnk_1" });
      expect(await storage.getItem(k2)).toEqual({ tenant: "acme", id: "lnk_2" });
      expect((await storage.getKeys("lnk/s/go.acme.com/")).sort()).toEqual([k1, k2].sort());
    });

    test("keys are case-sensitive (no collation folding)", async () => {
      const storage = await makeStorage();
      await storage.setItem("lnk/t/Acme/links/lnk_1", { v: "upper" });
      await storage.setItem("lnk/t/acme/links/lnk_1", { v: "lower" });
      await storage.setItem("lnk/t/acmé/links/lnk_1", { v: "accent" });
      expect(await storage.getItem("lnk/t/Acme/links/lnk_1")).toEqual({ v: "upper" });
      expect(await storage.getItem("lnk/t/acme/links/lnk_1")).toEqual({ v: "lower" });
      expect(await storage.getItem("lnk/t/acmé/links/lnk_1")).toEqual({ v: "accent" });
      expect(await storage.getKeys("lnk/t/Acme/")).toEqual(["lnk/t/Acme/links/lnk_1"]);
      expect(await storage.getKeys("lnk/t/acme/")).toEqual(["lnk/t/acme/links/lnk_1"]);
      await storage.removeItem("lnk/t/ACME/links/lnk_1");
      expect(await storage.getItem("lnk/t/Acme/links/lnk_1")).toEqual({ v: "upper" });
    });

    test("prefixes containing LIKE/GLOB metacharacters match literally", async () => {
      const storage = await makeStorage();
      const keys = [
        "lnk/x%y/a",
        "lnk/xzy/a",
        "lnk/x_y/a",
        "lnk/xay/a",
        "lnk/x!y/a",
        "lnk/x*y/a",
        "lnk/x[y/a",
      ];
      if (options.backslashKeys !== false) keys.push("lnk/x\\y/a");
      for (const k of keys) await storage.setItem(k, { k });
      expect(await storage.getKeys("lnk/x%y/")).toEqual(["lnk/x%y/a"]);
      expect(await storage.getKeys("lnk/x_y/")).toEqual(["lnk/x_y/a"]);
      expect(await storage.getKeys("lnk/x!y/")).toEqual(["lnk/x!y/a"]);
      if (options.backslashKeys !== false) {
        expect(await storage.getKeys("lnk/x\\y/")).toEqual(["lnk/x\\y/a"]);
      }
      expect(await storage.getKeys("lnk/x*y/")).toEqual(["lnk/x*y/a"]);
      expect(await storage.getKeys("lnk/x[y/")).toEqual(["lnk/x[y/a"]);
    });

    test("lists many keys", async () => {
      const storage = await makeStorage();
      for (let i = 0; i < 120; i++) {
        await storage.setItem(linkKey("bulk", `lnk_${String(i).padStart(3, "0")}`), { i });
      }
      expect((await storage.getKeys(linksPrefix("bulk"))).length).toBe(120);
    });
  });

  if (options.compareAndSwap) {
    describe(`CompareAndSwap semantics: ${name}`, () => {
      test("claims an absent key with expected null, once", async () => {
        const storage = await makeStorage();
        if (!isCompareAndSwap(storage)) throw new Error("expected compareAndSwap capability");
        const key = slugKey("go.acme.com", "sale");
        expect(
          await storage.compareAndSwap({ key, expected: null, next: { tenant: "a", id: "1" } }),
        ).toBe(true);
        expect(
          await storage.compareAndSwap({ key, expected: null, next: { tenant: "b", id: "2" } }),
        ).toBe(false);
        expect(await storage.getItem(key)).toEqual({ tenant: "a", id: "1" });
      });

      test("swaps only when the current value equals expected", async () => {
        const storage = await makeStorage();
        if (!isCompareAndSwap(storage)) throw new Error("expected compareAndSwap capability");
        await storage.setItem("lnk/cas", { n: 1, tags: ["a"] });
        expect(
          await storage.compareAndSwap({ key: "lnk/cas", expected: { n: 2 }, next: { n: 3 } }),
        ).toBe(false);
        expect(
          await storage.compareAndSwap({
            key: "lnk/cas",
            expected: { n: 1, tags: ["a"] },
            next: { n: 2, tags: ["a"] },
          }),
        ).toBe(true);
        expect(await storage.getItem("lnk/cas")).toEqual({ n: 2, tags: ["a"] });
      });

      test("concurrent claims of one key: exactly one wins", async () => {
        const storage = await makeStorage();
        if (!isCompareAndSwap(storage)) throw new Error("expected compareAndSwap capability");
        const key = slugKey("go.acme.com", "race");
        const results = await Promise.all(
          Array.from({ length: 8 }, (_, i) =>
            storage.compareAndSwap({ key, expected: null, next: { tenant: "t", id: `l${i}` } }),
          ),
        );
        expect(results.filter(Boolean).length).toBe(1);
      });
    });
  }

  if (options.watch) {
    const settleMs = typeof options.watch === "object" ? options.watch.settleMs : 50;
    describe(`Watch semantics: ${name}`, () => {
      test("notifies updates and removals under the prefix only", async () => {
        const storage = await makeStorage();
        if (!isWatchable(storage)) throw new Error("expected watch capability");
        const events: StorageChangeEvent[] = [];
        const off = await storage.watch("lnk/s/", (e) => events.push(e));
        await settle(settleMs);
        const key = slugKey("go.acme.com", "w");
        await storage.setItem(key, { tenant: "t", id: "1" });
        await storage.setItem("lnk/t/x/meta", { key: "x" });
        await settle(settleMs); // filesystem watchers coalesce a create immediately followed by a delete
        await storage.removeItem(key);
        await settle(settleMs);
        off();
        expect(events.some((e) => e.type === "update" && e.key === key)).toBe(true);
        expect(events.some((e) => e.type === "remove" && e.key === key)).toBe(true);
        expect(events.every((e) => e.key.startsWith("lnk/s/"))).toBe(true);
      });
    });
  }
}
