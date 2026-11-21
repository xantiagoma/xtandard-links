/**
 * Reusable conformance suite for the {@link AnalyticsSink} port (ADR 0006).
 * Every sink (memory, KV rollups, ClickHouse, Tinybird, Analytics Engine, …)
 * runs the same battery by calling {@link runAnalyticsContractTests}.
 *
 * Expected values are both hand-computed (so the reference itself is pinned)
 * and derived from {@link aggregateEvents}, the reference semantics.
 *
 * Each test uses fresh, randomly-suffixed tenant keys, so a factory may return
 * one shared sink (e.g. a single ClickHouse table per run).
 *
 * This file deliberately omits the `.test.ts` suffix so vitest does not pick it
 * up as a standalone suite — it only runs when imported by a sink's test.
 *
 * @module
 */

import { describe, expect, test } from "vitest";
import {
  aggregateEvents,
  ANALYTICS_DIMENSIONS,
  bucketStart,
  dimensionValue,
  matchesQuery,
  type AnalyticsDimension,
  type AnalyticsInterval,
  type AnalyticsMetrics,
  type AnalyticsQuery,
  type AnalyticsResult,
  type AnalyticsSink,
} from "../src/analytics/contract.ts";
import type { AnalyticsEvent, ClickEvent, LeadEvent, SaleEvent } from "../src/schema.ts";

/** A factory producing a sink. It may return the same instance every time. */
export type MakeSink = () => Promise<AnalyticsSink> | AnalyticsSink;

/** Options for {@link runAnalyticsContractTests}. Unset flags default to `sink.capabilities`. */
export interface AnalyticsContractOptions {
  /** Assert filter × groupBy on different dimensions (and multi-dimension filters). */
  crossFilter?: boolean;
  /** Assert `uniques` values. When false, `uniques` is ignored in comparisons. */
  uniques?: boolean;
  /** Run `events()` tests. */
  events?: boolean;
  /** Run `deleteLink()` tests. Default: whether the sink implements it. */
  deleteLink?: boolean;
  /** Intervals to test. */
  intervals?: AnalyticsInterval[];
  /** Awaited after every ingest/delete, for eventually-consistent backends. */
  settle?: (sink: AnalyticsSink) => Promise<void>;
  /**
   * Start of the fixture window (aligned down to a UTC day). Default: three
   * days before now, so retention-bounded sinks keep every fixture bucket.
   */
  baseTime?: string | number;
  /** Per-test timeout in ms (live backends). */
  timeout?: number;
}

const H = 3_600_000;
const D = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const LINKS: Record<string, { domain: string; slug: string }> = {
  lnk_a: { domain: "go.acme.com", slug: "a" },
  lnk_b: { domain: "acme.link", slug: "b" },
};

function base(tenant: string, id: string, at: number, linkId: string) {
  return {
    id,
    at: iso(at),
    tenant,
    linkId,
    ...(LINKS[linkId] ?? { domain: "go.acme.com", slug: linkId }),
  };
}

function click(
  tenant: string,
  id: string,
  at: number,
  linkId: string,
  fields: Partial<Omit<ClickEvent, "type">> = {},
): ClickEvent {
  return {
    type: "click",
    ...base(tenant, id, at, linkId),
    destination: `https://example.com/${linkId}`,
    device: "desktop",
    os: "macOS",
    browser: "Chrome",
    referrerHost: "(direct)",
    bot: false,
    qr: false,
    ...fields,
  };
}

function lead(tenant: string, id: string, at: number, linkId: string, clickId: string): LeadEvent {
  return {
    type: "lead",
    ...base(tenant, id, at, linkId),
    clickId,
    customerId: `cus_${id}`,
    name: "Sign up",
  };
}

function sale(
  tenant: string,
  id: string,
  at: number,
  linkId: string,
  clickId: string,
  amount: number,
  currency: string,
  extra: Partial<SaleEvent> = {},
): SaleEvent {
  return {
    type: "sale",
    ...base(tenant, id, at, linkId),
    clickId,
    customerId: `cus_${clickId}`,
    name: "Purchase",
    amount,
    currency,
    ...extra,
  };
}

/**
 * The fixture. `R = [B, B + 2d)` is the main window; `c7` sits exactly on its
 * exclusive end and `c8` 1 ms before its start.
 */
function fixture(B: number) {
  const suffix = Math.random().toString(36).slice(2, 10);
  const acme = `acme-${suffix}`;
  const other = `other-${suffix}`;
  const empty = `empty-${suffix}`;
  const c1 = click(acme, "c1", B + H + 5 * 60_000, "lnk_a", {
    country: "US",
    continent: "NA",
    city: "New York",
    referrer: "https://twitter.com/acme/status/1",
    referrerHost: "twitter.com",
    utm: { source: "twitter", medium: "social", campaign: "launch" },
    variant: "a",
    visitor: "v1",
    language: "en",
  });
  const c2 = click(acme, "c2", B + H + 30 * 60_000, "lnk_a", {
    country: "US",
    continent: "NA",
    device: "mobile",
    os: "iOS",
    browser: "Safari",
    qr: true,
    variant: "b",
    visitor: "v2",
  });
  const c3 = click(acme, "c3", B + 2 * H + 10 * 60_000, "lnk_a", {
    country: "DE",
    continent: "EU",
    city: "Berlin",
    os: "Windows",
    browser: "Firefox",
    referrer: "https://www.google.com/",
    referrerHost: "google.com",
    utm: { source: "google" },
    variant: "a",
    visitor: "v1",
  });
  const c4 = click(acme, "c4", B + 2 * H + 20 * 60_000, "lnk_a", {
    country: "US",
    continent: "NA",
    device: "bot",
    os: "Other",
    browser: "Googlebot",
    bot: true,
    visitor: "v9",
  });
  const l1 = lead(acme, "l1", B + 2 * H + 30 * 60_000, "lnk_a", "c1");
  const s1 = sale(acme, "s1", B + 3 * H, "lnk_a", "c1", 4999, "USD");
  const s2 = sale(acme, "s2", B + D + 5 * H, "lnk_a", "c1", 1000, "EUR", {
    invoiceId: "inv_1",
    metadata: { plan: "pro", seats: 3, tags: ["a", "b"], nested: { ok: true, none: null } },
  });
  const c5 = click(acme, "c5", B + D + 2 * H, "lnk_b", {
    country: "GB",
    continent: "EU",
    city: "London",
    device: "mobile",
    os: "Android",
    referrerHost: "twitter.com",
    utm: { source: "newsletter", medium: "email", campaign: "launch" },
    visitor: "v3",
  });
  const c6 = click(acme, "c6", B + D + 2 * H + 30 * 60_000, "lnk_b", {
    device: "unknown",
    os: "Unknown",
    browser: "Unknown",
    qr: true,
  });
  const l2 = lead(acme, "l2", B + D + 3 * H, "lnk_b", "c5");
  const c7 = click(acme, "c7", B + 2 * D, "lnk_a", {
    country: "US",
    continent: "NA",
    visitor: "v1",
  });
  const c8 = click(acme, "c8", B - 1, "lnk_b", { country: "US", continent: "NA", visitor: "v4" });
  const o1 = click(other, "o1", B + H + 10 * 60_000, "lnk_a", { country: "US", visitor: "v1" });
  const o2 = lead(other, "o2", B + 2 * H, "lnk_a", "o1");
  const o3 = sale(other, "o3", B + 3 * H, "lnk_a", "o1", 777, "USD");

  const events: AnalyticsEvent[] = [c1, c2, c3, c4, l1, s1, s2, c5, c6, l2, c7, c8, o1, o2, o3];
  return {
    B,
    acme,
    other,
    empty,
    R: { from: iso(B), to: iso(B + 2 * D) },
    wide: { from: iso(B - D), to: iso(B + 3 * D) },
    e: { c1, c2, c3, c4, l1, s1, s2, c5, c6, l2, c7, c8, o1, o2, o3 },
    events,
  };
}

/** Deterministic shuffle so ingestion order never matches time order. */
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  let seed = 42;
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function metrics(partial: Partial<AnalyticsMetrics> = {}): AnalyticsMetrics {
  return { clicks: 0, botClicks: 0, leads: 0, sales: 0, saleAmount: 0, uniques: 0, ...partial };
}

/** The reference result, with uniques computed independently of any sink. */
function reference(events: readonly AnalyticsEvent[], query: AnalyticsQuery): AnalyticsResult {
  const result = aggregateEvents(events, query);
  const visitorsOf = (pick: (e: AnalyticsEvent) => boolean) =>
    new Set(
      events
        .filter((e) => matchesQuery(e, query) && pick(e))
        .flatMap((e) => (e.type === "click" && !e.bot && e.visitor ? [e.visitor] : [])),
    ).size;
  result.totals.uniques = visitorsOf(() => true);
  for (const b of result.timeseries ?? []) {
    const t = Date.parse(b.at);
    b.uniques = visitorsOf((e) => bucketStart(Date.parse(e.at), query.interval!) === t);
  }
  for (const row of result.breakdown ?? []) {
    row.uniques = visitorsOf((e) => dimensionValue(e, query.groupBy!) === row.key);
  }
  return result;
}

/** Copy `result` keeping only comparable fields; drop `uniques` when not asserted. */
function normalize(result: AnalyticsResult, uniques: boolean): AnalyticsResult {
  const pick = <T extends AnalyticsMetrics>(m: T): T => {
    const out = { ...m };
    for (const k of ["clicks", "botClicks", "leads", "sales", "saleAmount"] as const) {
      out[k] = Number(out[k]);
    }
    if (uniques) out.uniques = Number(m.uniques);
    else delete out.uniques;
    return out;
  };
  const out: AnalyticsResult = { totals: pick(result.totals) };
  if (result.timeseries) out.timeseries = result.timeseries.map(pick);
  if (result.breakdown) out.breakdown = result.breakdown.map(pick);
  return out;
}

/**
 * Register a `describe(name, …)` block exercising the full
 * {@link AnalyticsSink} contract, gated by the sink's capabilities.
 */
export function runAnalyticsContractTests(
  name: string,
  makeSink: MakeSink,
  options: AnalyticsContractOptions = {},
): void {
  const timeout = options.timeout;
  const baseTime = () => {
    const raw =
      options.baseTime === undefined
        ? Date.now() - 3 * D
        : typeof options.baseTime === "number"
          ? options.baseTime
          : Date.parse(options.baseTime);
    return bucketStart(raw, "day");
  };

  interface Ctx {
    sink: AnalyticsSink;
    f: ReturnType<typeof fixture>;
    uniques: boolean;
    crossFilter: boolean;
    events: boolean;
    intervals: AnalyticsInterval[];
    settle(): Promise<void>;
    /** Query the sink and normalize. */
    q(query: Omit<AnalyticsQuery, "tenant"> & { tenant?: string }): Promise<AnalyticsResult>;
    /** Normalized reference for the same query. */
    ref(query: Omit<AnalyticsQuery, "tenant"> & { tenant?: string }): AnalyticsResult;
    /** Expected metrics (uniques dropped when not asserted). */
    m(partial?: Partial<AnalyticsMetrics>): AnalyticsMetrics;
  }

  async function setup(ingest = true): Promise<Ctx> {
    const sink = await makeSink();
    const f = fixture(baseTime());
    const caps = sink.capabilities;
    const uniques = options.uniques ?? caps.uniques;
    const settle = async () => {
      await options.settle?.(sink);
    };
    if (ingest) {
      await sink.ingest(shuffled(f.events));
      await settle();
    }
    const full = (query: Omit<AnalyticsQuery, "tenant"> & { tenant?: string }): AnalyticsQuery => ({
      tenant: f.acme,
      ...query,
    });
    return {
      sink,
      f,
      uniques,
      crossFilter: options.crossFilter ?? caps.crossFilter,
      events: (options.events ?? caps.events) && typeof sink.events === "function",
      intervals: options.intervals ?? caps.intervals,
      settle,
      q: async (query) => normalize(await sink.query(full(query)), uniques),
      ref: (query) => normalize(reference(f.events, full(query)), uniques),
      m: (partial) => normalize({ totals: metrics(partial) }, uniques).totals,
    };
  }

  describe(`AnalyticsSink contract: ${name}`, () => {
    test("declares capabilities", async () => {
      const sink = await makeSink();
      expect(typeof sink.capabilities.crossFilter).toBe("boolean");
      expect(typeof sink.capabilities.uniques).toBe("boolean");
      expect(typeof sink.capabilities.events).toBe("boolean");
      expect(sink.capabilities.intervals.length).toBeGreaterThan(0);
      if (sink.capabilities.events) expect(typeof sink.events).toBe("function");
    });

    test("ingest([]) is a no-op", { timeout }, async () => {
      const sink = await makeSink();
      await expect(sink.ingest([])).resolves.toBeUndefined();
    });

    describe("totals", () => {
      test("counts clicks, bot clicks, leads, sales and sale amount", { timeout }, async () => {
        const c = await setup();
        const r = await c.q(c.f.R);
        expect(r.totals).toEqual(
          c.m({ clicks: 5, botClicks: 1, leads: 2, sales: 2, saleAmount: 5999, uniques: 3 }),
        );
        expect(r).toEqual(c.ref(c.f.R));
      });

      test("timeseries and breakdown are absent unless requested", { timeout }, async () => {
        const c = await setup();
        const r = await c.sink.query({ tenant: c.f.acme, ...c.f.R });
        expect(r.timeseries).toBeUndefined();
        expect(r.breakdown).toBeUndefined();
      });

      test("bot clicks never count toward clicks or uniques", { timeout }, async () => {
        const c = await setup();
        const r = await c.q({ ...c.f.R, filters: { device: ["bot"] } });
        expect(r.totals).toEqual(c.m({ botClicks: 1 }));
      });

      test("[from, to) bounds: from inclusive, to exclusive", { timeout }, async () => {
        const c = await setup();
        const { c1, c2, c7, c8 } = c.f.e;
        expect((await c.q({ from: c1.at, to: c2.at })).totals).toEqual(
          c.m({ clicks: 1, uniques: 1 }),
        );
        // c7 sits exactly on R's end, c8 1 ms before its start: both excluded.
        expect((await c.q({ from: c7.at, to: iso(Date.parse(c7.at) + 1) })).totals).toEqual(
          c.m({ clicks: 1, uniques: 1 }),
        );
        expect((await c.q({ from: c8.at, to: c.f.R.from })).totals).toEqual(
          c.m({ clicks: 1, uniques: 1 }),
        );
        expect((await c.q(c.f.wide)).totals).toEqual(
          c.m({ clicks: 7, botClicks: 1, leads: 2, sales: 2, saleAmount: 5999, uniques: 4 }),
        );
        expect((await c.q({ from: c.f.R.to, to: c.f.R.to })).totals).toEqual(c.m());
      });

      test("tenants are isolated", { timeout }, async () => {
        const c = await setup();
        expect((await c.q({ tenant: c.f.other, ...c.f.R })).totals).toEqual(
          c.m({ clicks: 1, leads: 1, sales: 1, saleAmount: 777, uniques: 1 }),
        );
        expect((await c.q({ tenant: c.f.empty, ...c.f.R })).totals).toEqual(c.m());
      });

      test("concurrent ingests all land", { timeout }, async () => {
        const c = await setup(false);
        const events = shuffled(c.f.events);
        const third = Math.ceil(events.length / 3);
        await Promise.all([
          c.sink.ingest(events.slice(0, third)),
          c.sink.ingest(events.slice(third, 2 * third)),
          c.sink.ingest(events.slice(2 * third)),
        ]);
        await c.settle();
        expect(await c.q(c.f.wide)).toEqual(c.ref(c.f.wide));
        expect((await c.q(c.f.R)).totals.clicks).toBe(5);
      });

      test("events ingested in separate batches accumulate", { timeout }, async () => {
        const c = await setup();
        const { c1 } = c.f.e;
        await c.sink.ingest([{ ...c1, id: "c1-again", visitor: "v5" }]);
        await c.settle();
        expect((await c.q(c.f.R)).totals).toEqual(
          c.m({ clicks: 6, botClicks: 1, leads: 2, sales: 2, saleAmount: 5999, uniques: 4 }),
        );
      });
    });

    describe("links and filters", () => {
      test("linkIds restricts to those links", { timeout }, async () => {
        const c = await setup();
        expect((await c.q({ ...c.f.R, linkIds: ["lnk_a"] })).totals).toEqual(
          c.m({ clicks: 3, botClicks: 1, leads: 1, sales: 2, saleAmount: 5999, uniques: 2 }),
        );
        expect((await c.q({ ...c.f.R, linkIds: ["lnk_b"] })).totals).toEqual(
          c.m({ clicks: 2, leads: 1, uniques: 1 }),
        );
        expect((await c.q({ ...c.f.R, linkIds: ["lnk_a", "lnk_b"] })).totals.clicks).toBe(5);
        expect((await c.q({ ...c.f.R, linkIds: ["lnk_missing"] })).totals).toEqual(c.m());
      });

      test("an empty linkIds list matches nothing", { timeout }, async () => {
        const c = await setup();
        expect((await c.q({ ...c.f.R, linkIds: [] })).totals).toEqual(c.m());
      });

      test("filter on link combines with linkIds", { timeout }, async () => {
        const c = await setup();
        expect((await c.q({ ...c.f.R, filters: { link: ["lnk_b"] } })).totals).toEqual(
          c.m({ clicks: 2, leads: 1, uniques: 1 }),
        );
        expect(
          (await c.q({ ...c.f.R, linkIds: ["lnk_a"], filters: { link: ["lnk_b"] } })).totals,
        ).toEqual(c.m());
        const r = await c.q({
          ...c.f.R,
          linkIds: ["lnk_a", "lnk_b"],
          filters: { link: ["lnk_a"] },
          groupBy: "country",
          interval: "day",
        });
        expect(r).toEqual(
          c.ref({
            ...c.f.R,
            linkIds: ["lnk_a", "lnk_b"],
            filters: { link: ["lnk_a"] },
            groupBy: "country",
            interval: "day",
          }),
        );
      });

      test("a dimension filter matches any listed value", { timeout }, async () => {
        const c = await setup();
        expect((await c.q({ ...c.f.R, filters: { country: ["US"] } })).totals).toEqual(
          c.m({ clicks: 2, botClicks: 1, uniques: 2 }),
        );
        expect((await c.q({ ...c.f.R, filters: { country: ["US", "DE"] } })).totals).toEqual(
          c.m({ clicks: 3, botClicks: 1, uniques: 2 }),
        );
        expect((await c.q({ ...c.f.R, filters: { qr: ["true"] } })).totals).toEqual(
          c.m({ clicks: 2, uniques: 1 }),
        );
        expect((await c.q({ ...c.f.R, filters: { domain: ["acme.link"] } })).totals).toEqual(
          c.m({ clicks: 2, leads: 1, uniques: 1 }),
        );
        expect((await c.q({ ...c.f.R, filters: { country: ["ZZ"] } })).totals).toEqual(c.m());
      });

      test('"(none)" filters match absent values, incl. leads and sales', { timeout }, async () => {
        const c = await setup();
        expect((await c.q({ ...c.f.R, filters: { country: ["(none)"] } })).totals).toEqual(
          c.m({ clicks: 1, leads: 2, sales: 2, saleAmount: 5999 }),
        );
        expect((await c.q({ ...c.f.R, filters: { utm_source: ["(none)"] } })).totals).toEqual(
          c.m({ clicks: 2, botClicks: 1, leads: 2, sales: 2, saleAmount: 5999, uniques: 1 }),
        );
      });

      test("an empty filter list is ignored", { timeout }, async () => {
        const c = await setup();
        expect(await c.q({ ...c.f.R, filters: { country: [] } })).toEqual(await c.q(c.f.R));
      });

      test("a filter on the grouped dimension narrows the breakdown", { timeout }, async () => {
        const c = await setup();
        const r = await c.q({ ...c.f.R, filters: { country: ["US", "DE"] }, groupBy: "country" });
        expect(r.breakdown).toEqual([
          { key: "US", ...c.m({ clicks: 2, botClicks: 1, uniques: 2 }) },
          { key: "DE", ...c.m({ clicks: 1, uniques: 1 }) },
        ]);
      });

      test("cross filters: filter one dimension, group by another", { timeout }, async (t) => {
        const c = await setup();
        if (!c.crossFilter) return t.skip();
        const r = await c.q({ ...c.f.R, filters: { device: ["desktop"] }, groupBy: "country" });
        expect(r.breakdown).toEqual([
          { key: "DE", ...c.m({ clicks: 1, uniques: 1 }) },
          { key: "US", ...c.m({ clicks: 1, uniques: 1 }) },
        ]);
        expect(r.totals).toEqual(c.m({ clicks: 2, uniques: 1 }));
        for (const groupBy of ANALYTICS_DIMENSIONS) {
          const query = {
            ...c.f.wide,
            filters: { continent: ["NA", "EU"], qr: ["false"] },
            groupBy,
            limit: 100,
          };
          expect(await c.q(query), groupBy).toEqual(c.ref(query));
        }
      });

      test("filters on several dimensions are ANDed", { timeout }, async (t) => {
        const c = await setup();
        if (!c.crossFilter) return t.skip();
        expect(
          (await c.q({ ...c.f.R, filters: { country: ["US"], device: ["mobile"] } })).totals,
        ).toEqual(c.m({ clicks: 1, uniques: 1 }));
        expect(
          (await c.q({ ...c.f.R, filters: { country: ["US"], device: ["tablet"] } })).totals,
        ).toEqual(c.m());
      });

      test("filter values are data, never SQL", { timeout }, async () => {
        const c = await setup();
        const evil = ["' OR 1=1 --", "\\'", 'x"); DROP TABLE t; --', "{p0:String}", "\\"];
        for (const dim of ["country", "link", "utm_source"] as AnalyticsDimension[]) {
          expect((await c.q({ ...c.f.R, filters: { [dim]: evil } })).totals).toEqual(c.m());
        }
        expect((await c.q({ ...c.f.R, linkIds: evil })).totals).toEqual(c.m());
        expect((await c.q({ ...c.f.R, tenant: "' OR 1=1 --" })).totals).toEqual(c.m());
        expect((await c.q(c.f.R)).totals.clicks).toBe(5);
      });

      test("dimension values with quotes and unicode round-trip", { timeout }, async () => {
        const c = await setup(false);
        const tricky = 'O\'Brien \\ "Café" ☕ 東京';
        await c.sink.ingest([
          click(c.f.acme, "u1", c.f.B + H, "lnk_a", { city: tricky, visitor: "v1" }),
          click(c.f.acme, "u2", c.f.B + H, "lnk_a", { city: "plain" }),
        ]);
        await c.settle();
        const r = await c.q({ ...c.f.R, groupBy: "city", filters: { city: [tricky] } });
        expect(r.breakdown).toEqual([{ key: tricky, ...c.m({ clicks: 1, uniques: 1 }) }]);
      });
    });

    describe("timeseries", () => {
      test("hourly: contiguous, zero-filled, ascending, aligned", { timeout }, async (t) => {
        const c = await setup();
        if (!c.intervals.includes("hour")) return t.skip();
        const { B } = c.f;
        const query = { from: iso(B), to: iso(B + D), interval: "hour" as const };
        const r = await c.q(query);
        expect(r.timeseries).toHaveLength(24);
        expect(r.timeseries!.map((b) => b.at)).toEqual(
          Array.from({ length: 24 }, (_, i) => iso(B + i * H)),
        );
        expect(r.timeseries![0]).toEqual({ at: iso(B), ...c.m() });
        expect(r.timeseries![1]).toEqual({ at: iso(B + H), ...c.m({ clicks: 2, uniques: 2 }) });
        expect(r.timeseries![2]).toEqual({
          at: iso(B + 2 * H),
          ...c.m({ clicks: 1, botClicks: 1, leads: 1, uniques: 1 }),
        });
        expect(r.timeseries![3]).toEqual({
          at: iso(B + 3 * H),
          ...c.m({ sales: 1, saleAmount: 4999 }),
        });
        expect(r.timeseries![23]).toEqual({ at: iso(B + 23 * H), ...c.m() });
        expect(r.totals).toEqual(
          c.m({ clicks: 3, botClicks: 1, leads: 1, sales: 1, saleAmount: 4999, uniques: 2 }),
        );
        expect(r).toEqual(c.ref(query));
      });

      test("hourly: an unaligned from starts at its bucket", { timeout }, async (t) => {
        const c = await setup();
        if (!c.intervals.includes("hour")) return t.skip();
        const { B } = c.f;
        const query = { from: iso(B + 30 * 60_000), to: iso(B + 3 * H), interval: "hour" as const };
        const r = await c.q(query);
        expect(r.timeseries!.map((b) => b.at)).toEqual([iso(B), iso(B + H), iso(B + 2 * H)]);
        expect(r.totals).toEqual(c.m({ clicks: 3, botClicks: 1, leads: 1, uniques: 2 }));
        expect(r).toEqual(c.ref(query));
      });

      test("daily: buckets per UTC day", { timeout }, async (t) => {
        const c = await setup();
        if (!c.intervals.includes("day")) return t.skip();
        const { B } = c.f;
        const r = await c.q({ ...c.f.R, interval: "day" });
        expect(r.timeseries).toEqual([
          {
            at: iso(B),
            ...c.m({ clicks: 3, botClicks: 1, leads: 1, sales: 1, saleAmount: 4999, uniques: 2 }),
          },
          {
            at: iso(B + D),
            ...c.m({ clicks: 2, leads: 1, sales: 1, saleAmount: 1000, uniques: 1 }),
          },
        ]);
        const wide = await c.q({ ...c.f.wide, interval: "day" });
        expect(wide.timeseries!.map((b) => b.at)).toEqual([
          iso(B - D),
          iso(B),
          iso(B + D),
          iso(B + 2 * D),
        ]);
        expect(wide).toEqual(c.ref({ ...c.f.wide, interval: "day" }));
      });

      test("daily: an unaligned window counts only events inside it", { timeout }, async (t) => {
        const c = await setup();
        if (!c.intervals.includes("day")) return t.skip();
        const { B } = c.f;
        const r = await c.q({ from: iso(B + 12 * H), to: iso(B + D + 12 * H), interval: "day" });
        expect(r.timeseries).toEqual([
          { at: iso(B), ...c.m() },
          {
            at: iso(B + D),
            ...c.m({ clicks: 2, leads: 1, sales: 1, saleAmount: 1000, uniques: 1 }),
          },
        ]);
      });

      test("an empty tenant gets a fully zero-filled series", { timeout }, async () => {
        const c = await setup();
        const interval = c.intervals.includes("hour") ? "hour" : "day";
        const r = await c.q({ tenant: c.f.empty, ...c.f.R, interval });
        expect(r.timeseries).toHaveLength(interval === "hour" ? 48 : 2);
        for (const b of r.timeseries!) expect(b).toEqual({ at: b.at, ...c.m() });
      });

      test("timeseries respects filters and linkIds", { timeout }, async () => {
        const c = await setup();
        for (const interval of c.intervals) {
          const queries: Omit<AnalyticsQuery, "tenant">[] = [
            { ...c.f.wide, interval, linkIds: ["lnk_b"] },
            { ...c.f.wide, interval, filters: { country: ["US"] } },
            { ...c.f.wide, interval, filters: { link: ["lnk_a"] }, groupBy: "link" },
          ];
          for (const query of queries) expect(await c.q(query)).toEqual(c.ref(query));
        }
      });
    });

    describe("breakdown", () => {
      test("groupBy link", { timeout }, async () => {
        const c = await setup();
        const r = await c.q({ ...c.f.R, groupBy: "link" });
        expect(r.breakdown).toEqual([
          {
            key: "lnk_a",
            ...c.m({ clicks: 3, botClicks: 1, leads: 1, sales: 2, saleAmount: 5999, uniques: 2 }),
          },
          { key: "lnk_b", ...c.m({ clicks: 2, leads: 1, uniques: 1 }) },
        ]);
      });

      test(
        'groupBy country: "(none)" collects missing values and conversions',
        { timeout },
        async () => {
          const c = await setup();
          const r = await c.q({ ...c.f.R, groupBy: "country" });
          expect(r.breakdown).toEqual([
            { key: "US", ...c.m({ clicks: 2, botClicks: 1, uniques: 2 }) },
            { key: "(none)", ...c.m({ clicks: 1, leads: 2, sales: 2, saleAmount: 5999 }) },
            { key: "DE", ...c.m({ clicks: 1, uniques: 1 }) },
            { key: "GB", ...c.m({ clicks: 1, uniques: 1 }) },
          ]);
        },
      );

      test("groupBy device / referrer / qr / variant / domain", { timeout }, async () => {
        const c = await setup();
        const keys = async (groupBy: AnalyticsDimension) =>
          (await c.q({ ...c.f.R, groupBy })).breakdown!.map((r) => r.key);
        expect(await keys("device")).toEqual(["desktop", "mobile", "unknown", "(none)", "bot"]);
        expect(await keys("referrer")).toEqual(["(direct)", "twitter.com", "google.com", "(none)"]);
        expect(await keys("qr")).toEqual(["false", "true", "(none)"]);
        expect(await keys("variant")).toEqual(["(none)", "a", "b"]);
        expect(await keys("domain")).toEqual(["go.acme.com", "acme.link"]);
        expect(await keys("utm_source")).toEqual(["(none)", "google", "newsletter", "twitter"]);
        expect(await keys("utm_campaign")).toEqual(["(none)", "launch"]);
      });

      test("every dimension matches the reference", { timeout }, async () => {
        const c = await setup();
        const interval = c.intervals[0];
        for (const groupBy of ANALYTICS_DIMENSIONS) {
          const query = { ...c.f.wide, groupBy, interval, limit: 100 };
          expect(await c.q(query), groupBy).toEqual(c.ref(query));
        }
      });

      test("limit truncates after sorting; default limit is 10", { timeout }, async () => {
        const c = await setup();
        const keys = async (limit?: number) =>
          (await c.q({ ...c.f.R, groupBy: "country", limit })).breakdown!.map((r) => r.key);
        expect(await keys(2)).toEqual(["US", "(none)"]);
        expect(await keys(1)).toEqual(["US"]);
        expect(await keys(0)).toEqual([]);

        const many = Array.from({ length: 12 }, (_, i) =>
          click(c.f.acme, `m${i}`, c.f.B + 4 * H, "lnk_a", {
            city: `city-${String(i).padStart(2, "0")}`,
          }),
        );
        await c.sink.ingest(many);
        await c.settle();
        const r = await c.q({ ...c.f.R, groupBy: "city" });
        expect(r.breakdown).toHaveLength(10);
        // (none) has 2 clicks + every conversion; every other city has 1; ties sort by key.
        expect(r.breakdown!.map((row) => row.key)).toEqual([
          "(none)",
          "Berlin",
          "London",
          "New York",
          ...Array.from({ length: 6 }, (_, i) => `city-${String(i).padStart(2, "0")}`),
        ]);
      });

      test("sort: clicks desc, then leads, sales, saleAmount, key asc", { timeout }, async () => {
        const c = await setup(false);
        const { acme, B } = c.f;
        const t = B + H;
        const k = (n: number) => `lnk_k${n}`;
        await c.sink.ingest([
          // k9: two clicks → first. Everything else has one click.
          click(acme, "k9a", t, k(9)),
          click(acme, "k9b", t, k(9)),
          click(acme, "k0", t, k(0)),
          click(acme, "k1", t, k(1)),
          click(acme, "k2", t, k(2)),
          lead(acme, "k2l", t, k(2), "k2"),
          click(acme, "k3", t, k(3)),
          sale(acme, "k3s", t, k(3), "k3", 10, "USD"),
          click(acme, "k4", t, k(4)),
          sale(acme, "k4s", t, k(4), "k4", 20, "USD"),
          click(acme, "k5", t, k(5)),
          sale(acme, "k5s1", t, k(5), "k5", 1, "USD"),
          sale(acme, "k5s2", t, k(5), "k5", 1, "USD"),
        ]);
        await c.settle();
        const r = await c.q({ ...c.f.R, groupBy: "link" });
        // clicks desc → leads desc → sales desc → saleAmount desc → key asc.
        expect(r.breakdown!.map((row) => row.key)).toEqual([9, 2, 5, 4, 3, 0, 1].map((n) => k(n)));
        expect(r.breakdown![2]).toEqual({
          key: k(5),
          ...c.m({ clicks: 1, sales: 2, saleAmount: 2 }),
        });
      });

      test("an empty result yields an empty breakdown", { timeout }, async () => {
        const c = await setup();
        const r = await c.q({ tenant: c.f.empty, ...c.f.R, groupBy: "country" });
        expect(r.breakdown).toEqual([]);
        expect(r.totals).toEqual(c.m());
      });

      test("timeseries + breakdown together", { timeout }, async () => {
        const c = await setup();
        for (const interval of c.intervals) {
          const query = { ...c.f.R, interval, groupBy: "device" as const, linkIds: ["lnk_a"] };
          expect(await c.q(query)).toEqual(c.ref(query));
        }
      });
    });

    describe("events()", () => {
      const newestFirst = (f: ReturnType<typeof fixture>) => {
        const { c1, c2, c3, l1, s1, s2, c5, c6, l2, c7, c8 } = f.e;
        return [c7, s2, l2, c6, c5, s1, l1, c3, c2, c1, c8];
      };

      test("newest first, bots excluded by default, events round-trip", { timeout }, async (t) => {
        const c = await setup();
        if (!c.events) return t.skip();
        expect(await c.sink.events!({ tenant: c.f.acme })).toEqual(newestFirst(c.f));
      });

      test("includeBots adds bot clicks in order", { timeout }, async (t) => {
        const c = await setup();
        if (!c.events) return t.skip();
        const ids = (await c.sink.events!({ tenant: c.f.acme, includeBots: true })).map(
          (e) => e.id,
        );
        expect(ids).toEqual([
          "c7",
          "s2",
          "l2",
          "c6",
          "c5",
          "s1",
          "l1",
          "c4",
          "c3",
          "c2",
          "c1",
          "c8",
        ]);
      });

      test("types and linkIds filters", { timeout }, async (t) => {
        const c = await setup();
        if (!c.events) return t.skip();
        const ids = async (q: { types?: AnalyticsEvent["type"][]; linkIds?: string[] }) =>
          (await c.sink.events!({ tenant: c.f.acme, ...q })).map((e) => e.id);
        expect(await ids({ types: ["lead", "sale"] })).toEqual(["s2", "l2", "s1", "l1"]);
        expect(await ids({ types: ["sale"] })).toEqual(["s2", "s1"]);
        expect(await ids({ linkIds: ["lnk_b"] })).toEqual(["l2", "c6", "c5", "c8"]);
        expect(await ids({ linkIds: ["lnk_b"], types: ["click"] })).toEqual(["c6", "c5", "c8"]);
        expect(await ids({ linkIds: ["lnk_missing"] })).toEqual([]);
      });

      test("tenants are isolated", { timeout }, async (t) => {
        const c = await setup();
        if (!c.events) return t.skip();
        expect((await c.sink.events!({ tenant: c.f.other })).map((e) => e.id)).toEqual([
          "o3",
          "o2",
          "o1",
        ]);
        expect(await c.sink.events!({ tenant: c.f.empty })).toEqual([]);
      });

      test("limit and before page backwards without gaps", { timeout }, async (t) => {
        const c = await setup();
        if (!c.events) return t.skip();
        const all = newestFirst(c.f).map((e) => e.id);
        expect((await c.sink.events!({ tenant: c.f.acme, limit: 3 })).map((e) => e.id)).toEqual(
          all.slice(0, 3),
        );
        const pages: string[] = [];
        let before: string | undefined;
        for (let i = 0; i < 10; i++) {
          const page = await c.sink.events!({ tenant: c.f.acme, limit: 4, before });
          if (page.length === 0) break;
          pages.push(...page.map((e) => e.id));
          before = page[page.length - 1]!.at;
        }
        expect(pages).toEqual(all);
        // `before` is exclusive.
        const { s1 } = c.f.e;
        expect(
          (await c.sink.events!({ tenant: c.f.acme, before: s1.at })).map((e) => e.id),
        ).toEqual(["l1", "c3", "c2", "c1", "c8"]);
      });

      test("default limit is 50", { timeout }, async (t) => {
        const c = await setup(false);
        if (!c.events) return t.skip();
        const batch = Array.from({ length: 60 }, (_, i) =>
          click(c.f.acme, `bulk${String(i).padStart(2, "0")}`, c.f.B + i * 60_000, "lnk_a"),
        );
        await c.sink.ingest(batch);
        await c.settle();
        const page = await c.sink.events!({ tenant: c.f.acme });
        expect(page).toHaveLength(50);
        expect(page[0]!.id).toBe("bulk59");
        expect(page[49]!.id).toBe("bulk10");
      });
    });

    describe("deleteLink()", () => {
      test("drops one link's events for one tenant only", { timeout }, async (t) => {
        const c = await setup();
        const enabled = options.deleteLink ?? typeof c.sink.deleteLink === "function";
        if (!enabled) return t.skip();
        await c.sink.deleteLink!(c.f.acme, "lnk_a");
        await c.settle();
        expect((await c.q(c.f.R)).totals).toEqual(c.m({ clicks: 2, leads: 1, uniques: 1 }));
        expect((await c.q({ ...c.f.R, linkIds: ["lnk_a"] })).totals).toEqual(c.m());
        expect((await c.q({ tenant: c.f.other, ...c.f.R })).totals.clicks).toBe(1);
        if (c.events) {
          const ids = (await c.sink.events!({ tenant: c.f.acme, includeBots: true })).map(
            (e) => e.id,
          );
          expect(ids).toEqual(["l2", "c6", "c5", "c8"]);
        }
        await expect(c.sink.deleteLink!(c.f.acme, "lnk_missing")).resolves.toBeUndefined();
      });
    });
  });
}
