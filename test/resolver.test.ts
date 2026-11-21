import { describe, expect, test } from "vitest";
import { createLinksCore, createResolver } from "../src/index.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";
import { createCollectingSink } from "../src/testing.ts";

const setup = (ttlMs = 60_000) => {
  let t = 1_000_000;
  const storage = createMemoryStorage();
  const core = createLinksCore({
    storage,
    analytics: createCollectingSink(),
    defaultDomain: "sho.rt",
    now: () => t,
  });
  let reads = 0;
  const original = storage.getItem.bind(storage);
  storage.getItem = async <T>(key: string) => {
    reads++;
    return original<T>(key);
  };
  const advance = (ms: number) => (t += ms);
  return { core, storage, advance, reads: () => reads, original, ttlMs };
};

describe("resolver", () => {
  test("caches hits and misses within their TTLs", async () => {
    const { core, advance, reads } = setup();
    await core.createLink({ url: "https://a.example", slug: "x" });
    const resolver = createResolver(core, { ttlMs: 1000, negativeTtlMs: 100, watch: false });
    expect((await resolver.resolve("sho.rt", "x")).link?.url).toBe("https://a.example");
    const before = reads();
    await resolver.resolve("SHO.RT", "X");
    expect(reads()).toBe(before);
    await resolver.resolve("sho.rt", "nope");
    const afterMiss = reads();
    await resolver.resolve("sho.rt", "nope");
    expect(reads()).toBe(afterMiss);
    advance(200);
    await resolver.resolve("sho.rt", "nope");
    expect(reads()).toBeGreaterThan(afterMiss);
    expect(resolver.stats().hits).toBeGreaterThan(0);
  });

  test("same-process mutations evict immediately", async () => {
    const { core } = setup();
    const link = await core.createLink({ url: "https://a.example", slug: "x" });
    const resolver = createResolver(core, { watch: false });
    await resolver.resolve("sho.rt", "x");
    await core.updateLink("default", link.id, { url: "https://b.example" });
    expect((await resolver.resolve("sho.rt", "x")).link?.url).toBe("https://b.example");
    await core.deleteLink("default", link.id);
    expect((await resolver.resolve("sho.rt", "x")).link).toBeNull();
  });

  test("watchable storage evicts on writes from elsewhere", async () => {
    const { core, storage } = setup();
    const link = await core.createLink({ url: "https://a.example", slug: "x" });
    const resolver = createResolver(core);
    await new Promise((r) => setTimeout(r, 5));
    await resolver.resolve("sho.rt", "x");
    // Simulate another process editing the stored record directly.
    const key = `lnk/t/default/links/${link.id}`;
    await storage.setItem(key, { ...link, url: "https://c.example" });
    await new Promise((r) => setTimeout(r, 5));
    expect((await resolver.resolve("sho.rt", "x")).link?.url).toBe("https://c.example");
    resolver.close();
  });

  test("stale-while-revalidate and last-known-good on storage errors", async () => {
    const { core, storage, advance } = setup();
    await core.createLink({ url: "https://a.example", slug: "x" });
    const errors: unknown[] = [];
    const resolver = createResolver(core, {
      ttlMs: 100,
      watch: false,
      onError: (e) => errors.push(e),
    });
    await resolver.resolve("sho.rt", "x");
    advance(500);
    storage.getItem = async () => {
      throw new Error("down");
    };
    expect((await resolver.resolve("sho.rt", "x")).link?.url).toBe("https://a.example");
    await new Promise((r) => setTimeout(r, 5));
    expect(errors.length).toBeGreaterThan(0);
    expect((await resolver.resolve("sho.rt", "x")).link?.url).toBe("https://a.example");
    expect((await resolver.resolve("sho.rt", "never")).link).toBeNull();
  });

  test("coalesces concurrent loads and preloads", async () => {
    const { core, reads } = setup();
    await core.createLink({ url: "https://a.example", slug: "x" });
    await core.createLink({ url: "https://b.example", slug: "y" });
    const resolver = createResolver(core, { watch: false });
    const before = reads();
    await Promise.all(Array.from({ length: 10 }, () => resolver.resolve("sho.rt", "x")));
    expect(reads() - before).toBeLessThanOrEqual(5); // one domain + one link load, not ten
    const fresh = createResolver(core, { watch: false });
    expect(await fresh.preload()).toBe(2);
    const afterPreload = reads();
    await fresh.resolve("sho.rt", "y");
    expect(reads()).toBe(afterPreload);
    fresh.invalidate();
    expect(fresh.stats().size).toBe(0);
  });

  test("ttl 0 disables caching", async () => {
    const { core, reads } = setup();
    await core.createLink({ url: "https://a.example", slug: "x" });
    const resolver = createResolver(core, { ttlMs: 0, watch: false });
    await resolver.resolve("sho.rt", "x");
    const r = reads();
    await resolver.resolve("sho.rt", "x");
    expect(reads()).toBeGreaterThan(r);
  });

  test("evicts least recently used beyond maxEntries", async () => {
    const { core } = setup();
    for (const s of ["a", "b", "c"]) await core.createLink({ url: "https://a.example", slug: s });
    const resolver = createResolver(core, { maxEntries: 2, watch: false });
    for (const s of ["a", "b", "c"]) await resolver.resolve("sho.rt", s);
    expect(resolver.stats().size).toBeLessThanOrEqual(2);
  });
});
