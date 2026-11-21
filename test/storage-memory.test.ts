import { describe, expect, it, test } from "vitest";
import { isCompareAndSwap, isWatchable } from "../src/storage/contract.ts";
import { createMemoryStorage, deepEqual } from "../src/storage/memory.ts";
import { runStorageContractTests } from "./storage-contract.ts";

runStorageContractTests("memory", () => createMemoryStorage(), {
  t: { describe, test, expect },
  capabilities: { compareAndSwap: true, watch: { settleMs: 5 } },
});

describe("memory storage extras", () => {
  it("implements watch and compare-and-swap", () => {
    const storage = createMemoryStorage();
    expect(isWatchable(storage)).toBe(true);
    expect(isCompareAndSwap(storage)).toBe(true);
  });

  it("seeds initial data", async () => {
    const storage = createMemoryStorage({ initial: { "lnk/tenants": ["acme"] } });
    expect(await storage.getItem("lnk/tenants")).toEqual(["acme"]);
  });

  it("still exports deepEqual (own properties, key order ignored)", () => {
    expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(deepEqual({ a: undefined }, { b: undefined })).toBe(false);
  });
});
