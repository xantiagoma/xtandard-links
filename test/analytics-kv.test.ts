import { describe, expect, test } from "vitest";
import { createKvAnalytics, UnsupportedQueryError, type AnalyticsEvent } from "../src/index.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";

const H = 3_600_000;
const T0 = Date.parse("2026-06-01T00:00:00Z");
let n = 0;
const click = (over: Partial<Extract<AnalyticsEvent, { type: "click" }>> = {}): AnalyticsEvent => ({
  type: "click",
  id: `clk_${String(n++).padStart(26, "0")}`,
  at: new Date(T0).toISOString(),
  tenant: "t",
  linkId: "l1",
  domain: "sho.rt",
  slug: "a",
  destination: "https://x",
  device: "desktop",
  os: "macos",
  browser: "chrome",
  referrerHost: "(direct)",
  bot: false,
  qr: false,
  country: "US",
  ...over,
});

describe("KV rollup sink", () => {
  test("totals, timeseries, breakdowns, link scoping", async () => {
    const sink = createKvAnalytics({ storage: createMemoryStorage() });
    await sink.ingest([
      click(),
      click({ country: "DE", at: new Date(T0 + 2 * H).toISOString() }),
      click({ linkId: "l2", country: "DE", at: new Date(T0 + 30 * H).toISOString() }),
      click({ bot: true }),
      {
        type: "sale",
        id: "sale_1",
        at: new Date(T0 + H).toISOString(),
        tenant: "t",
        linkId: "l1",
        domain: "sho.rt",
        slug: "a",
        clickId: "c",
        customerId: "u",
        name: "P",
        amount: 500,
        currency: "USD",
      },
    ]);
    const range = {
      tenant: "t",
      from: new Date(T0).toISOString(),
      to: new Date(T0 + 48 * H).toISOString(),
    };
    const all = await sink.query({ ...range, interval: "day", groupBy: "country" });
    expect(all.totals).toEqual({ clicks: 3, botClicks: 1, leads: 0, sales: 1, saleAmount: 500 });
    expect(all.timeseries?.map((b) => b.clicks)).toEqual([2, 1]);
    expect(all.breakdown?.slice(0, 2)).toMatchObject([
      { key: "DE", clicks: 2 },
      { key: "US", clicks: 1 },
    ]);
    const l1 = await sink.query({ ...range, linkIds: ["l1"], groupBy: "link" });
    expect(l1.totals.clicks).toBe(2);
    expect(l1.breakdown).toMatchObject([{ key: "l1", clicks: 2 }]);
    const byLink = await sink.query({ ...range, groupBy: "link" });
    expect(byLink.breakdown?.map((r) => r.key)).toEqual(["l1", "l2"]);
    const hourly = await sink.query({
      tenant: "t",
      from: new Date(T0).toISOString(),
      to: new Date(T0 + 3 * H).toISOString(),
      interval: "hour",
    });
    expect(hourly.timeseries?.map((b) => b.clicks)).toEqual([1, 0, 1]);
    // Edge hours of a partial day use hourly buckets.
    const partial = await sink.query({
      tenant: "t",
      from: new Date(T0 + H).toISOString(),
      to: new Date(T0 + 31 * H).toISOString(),
    });
    expect(partial.totals.clicks).toBe(2);
    expect((await sink.query({ ...range, tenant: "other" })).totals.clicks).toBe(0);
  });

  test("single-dimension filters; unsupported combinations throw", async () => {
    const sink = createKvAnalytics({ storage: createMemoryStorage() });
    await sink.ingest([click(), click({ country: "DE", device: "mobile" })]);
    const range = {
      tenant: "t",
      from: new Date(T0).toISOString(),
      to: new Date(T0 + 24 * H).toISOString(),
    };
    const de = await sink.query({
      ...range,
      filters: { country: ["DE"] },
      interval: "day",
      groupBy: "country",
    });
    expect(de.totals.clicks).toBe(1);
    expect(de.breakdown).toMatchObject([{ key: "DE" }]);
    await expect(
      sink.query({ ...range, filters: { country: ["DE"] }, groupBy: "device" }),
    ).rejects.toThrow(UnsupportedQueryError);
    await expect(
      sink.query({ ...range, filters: { country: ["DE"], device: ["mobile"] } }),
    ).rejects.toThrow(UnsupportedQueryError);
    const viaLinkFilter = await sink.query({
      ...range,
      filters: { link: ["l1"] },
      groupBy: "device",
    });
    expect(viaLinkFilter.breakdown?.length).toBe(2);
  });

  test("recent events, deleteLink, prune", async () => {
    let now = T0;
    const sink = createKvAnalytics({
      storage: createMemoryStorage(),
      hourlyRetention: "1d",
      recentEvents: 2,
      now: () => now,
    });
    await sink.ingest([click(), click({ bot: true }), click({ linkId: "l2" })]);
    const recent = await sink.events?.({ tenant: "t" });
    expect(recent?.map((e) => e.linkId)).toEqual(["l2", "l1"]);
    expect((await sink.events?.({ tenant: "t", includeBots: true }))?.length).toBe(3);
    await sink.deleteLink?.("t", "l2");
    expect((await sink.events?.({ tenant: "t" }))?.map((e) => e.linkId)).toEqual(["l1"]);
    now = T0 + 3 * 86_400_000;
    const pruned = await sink.prune();
    expect(pruned.buckets).toBeGreaterThan(0);
    expect(pruned.events).toBe(0);
    // Daily buckets survive the hourly retention; deleteLink subtracted l2 from tenant totals.
    const q = await sink.query({
      tenant: "t",
      from: new Date(T0).toISOString(),
      to: new Date(T0 + 86_400_000).toISOString(),
      groupBy: "link",
    });
    expect(q.totals.clicks).toBe(1);
    expect(q.breakdown?.map((r) => r.key)).toEqual(["l1"]);
    const gone = await sink.query({
      tenant: "t",
      linkIds: ["l2"],
      from: new Date(T0).toISOString(),
      to: new Date(T0 + 86_400_000).toISOString(),
    });
    expect(gone.totals.clicks).toBe(0);
  });

  test("concurrent ingests do not lose counts (CAS)", async () => {
    const sink = createKvAnalytics({ storage: createMemoryStorage() });
    await Promise.all(Array.from({ length: 10 }, () => sink.ingest([click()])));
    const q = await sink.query({
      tenant: "t",
      from: new Date(T0).toISOString(),
      to: new Date(T0 + H).toISOString(),
    });
    expect(q.totals.clicks).toBe(10);
  });
});
