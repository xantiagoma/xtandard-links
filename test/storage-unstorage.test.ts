import { createStorage } from "unstorage";
import { describe, expect, test } from "vitest";
import { createUnstorageStorage } from "../src/storage/unstorage.ts";
import { runStorageContractTests } from "./storage-contract.ts";

runStorageContractTests(
  "unstorage (memory driver)",
  () => createUnstorageStorage({ storage: createStorage() }),
  { backslashKeys: false },
);

describe("createUnstorageStorage specifics", () => {
  test("getKeys returns slash-separated keys, not unstorage's colon form", async () => {
    const storage = createUnstorageStorage({ storage: createStorage() });
    await storage.setItem("lnk/t/acme/links/lnk_1", { v: 1 });
    await storage.setItem("lnk/t/acme/meta", { key: "acme" });
    const keys = await storage.getKeys("lnk/t/acme/");
    expect(keys.sort()).toEqual(["lnk/t/acme/links/lnk_1", "lnk/t/acme/meta"]);
    for (const k of keys) expect(k).not.toContain(":");
  });

  test("auto-deserializes JSON values and yields null for missing", async () => {
    const storage = createUnstorageStorage({ storage: createStorage() });
    expect(await storage.getItem("lnk/t/acme/none")).toBeNull();
    await storage.setItem("lnk/t/acme/obj", { nested: { ok: true } });
    expect(await storage.getItem("lnk/t/acme/obj")).toEqual({ nested: { ok: true } });
  });
});
