import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, test } from "vitest";
import { clearFileStorage, createFileStorage } from "../src/storage/file.ts";
import { runStorageContractTests } from "./storage-contract.ts";

const roots: string[] = [];

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xtandard-links-file-"));
  roots.push(dir);
  return join(dir, "store");
}

afterAll(async () => {
  await Promise.all(roots.map((dir) => clearFileStorage({ dir })));
});

runStorageContractTests("file", () => createFileStorage({ dir: freshDir() }), {
  t: { describe, test, expect },
  capabilities: { compareAndSwap: true, watch: { settleMs: 200 } },
});

describe("file storage extras", () => {
  it("getKeys on a missing base dir returns empty", async () => {
    const storage = createFileStorage({ dir: freshDir() });
    expect(await storage.getKeys("lnk/")).toEqual([]);
  });

  it("clearFileStorage removes everything", async () => {
    const dir = freshDir();
    const storage = createFileStorage({ dir });
    await storage.setItem("lnk/t/acme/a", { v: 1 });
    await clearFileStorage({ dir });
    expect(await storage.getKeys("lnk/")).toEqual([]);
  });

  it("stores keys that differ only by case in different files", async () => {
    const dir = freshDir();
    const storage = createFileStorage({ dir });
    await storage.setItem("lnk/t/Acme/a", { v: 1 });
    await storage.setItem("lnk/t/acme/a", { v: 2 });
    expect(readdirSync(join(dir, "lnk", "t")).sort()).toEqual(["^acme", "acme"]);
  });

  it("persists across instances pointed at the same dir", async () => {
    const dir = freshDir();
    await createFileStorage({ dir }).setItem("lnk/t/acme/a", { v: 7 });
    expect(await createFileStorage({ dir }).getItem("lnk/t/acme/a")).toEqual({ v: 7 });
  });
});
