/**
 * The default analytics sink: time-bucket rollups in the links storage itself
 * (ADR 0006) — zero extra infrastructure.
 *
 * Each ingested batch is aggregated in memory first, then applied with one
 * read-modify-write per touched bucket (compare-and-swap retried when the
 * storage supports it). Buckets exist per tenant and per link, hourly (kept
 * `hourlyRetention`) and daily (kept `dailyRetention`, default forever), and
 * carry metric counters plus per-dimension counters. A bounded recent-events
 * log feeds "recent activity" views.
 *
 * Semantics vs. the reference: bucket-granular. An event counts when its hour
 * lies in `[floor(from), to)`; ranges are answered from daily buckets where a
 * whole UTC day is inside the range and from hourly buckets at the edges. Query
 * limitations (reported via `capabilities`): no unique visitors, and at most one
 * non-link filter dimension, which cannot be combined with grouping by another
 * dimension (`crossFilter: false`). `deleteLink` drops the link's own rollups
 * and recent events; tenant-wide totals keep its historical counts.
 *
 * Key layout (under `lnk/rollup/`):
 *
 * ```txt
 * lnk/rollup/{tenant}/{scope}/{h|d}/{bucket}   scope = "_" (tenant) | "l.{linkId}"
 * lnk/rollup/{tenant}/ev/{eventId}             recent raw events (time-sortable ids)
 * ```
 *
 * @module
 */

import { durationToMs } from "../duration.ts";
import type { AnalyticsEvent, LinksDuration } from "../schema.ts";
import { isCompareAndSwap, type LinksStorage } from "../storage/contract.ts";
import {
  ANALYTICS_DIMENSIONS,
  bucketRange,
  bucketStart,
  dimensionValue,
  sortBreakdown,
  type AnalyticsBreakdownRow,
  type AnalyticsCapabilities,
  type AnalyticsDimension,
  type AnalyticsInterval,
  type AnalyticsMetrics,
  type AnalyticsQuery,
  type AnalyticsResult,
  type AnalyticsSink,
  type EventsQuery,
} from "./contract.ts";

/** Compact metrics tuple: clicks, botClicks, leads, sales, saleAmount. */
type Packed = [number, number, number, number, number];

/** A stored rollup bucket. */
export interface RollupBucket {
  m: Packed;
  d: Partial<Record<AnalyticsDimension, Record<string, Packed>>>;
}

/** Thrown for queries the KV rollups cannot answer (see module docs). */
export class UnsupportedQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedQueryError";
  }
}

/** Options for {@link createKvAnalytics}. */
export interface KvAnalyticsOptions {
  storage: LinksStorage;
  /** How long hourly buckets are kept. Default `"14d"`. */
  hourlyRetention?: LinksDuration;
  /** How long daily buckets are kept. Default: forever. */
  dailyRetention?: LinksDuration;
  /** Max recent raw events kept per tenant (0 disables). Default 1000. */
  recentEvents?: number;
  /** Clock, for retention. */
  now?: () => number;
}

/** The KV sink, with a retention sweep. */
export interface KvAnalytics extends AnalyticsSink {
  /** Drop expired hourly/daily buckets and trim recent events. */
  prune(): Promise<{ buckets: number; events: number }>;
}

const ROOT = "lnk/rollup";
const enc = encodeURIComponent;
const TENANT_SCOPE = "_";
const linkScope = (linkId: string) => `l.${linkId}`;

const bucketKey = (tenant: string, scope: string, interval: AnalyticsInterval, at: number) =>
  `${ROOT}/${enc(tenant)}/${enc(scope)}/${interval === "hour" ? "h" : "d"}/${new Date(at)
    .toISOString()
    .slice(0, interval === "hour" ? 13 : 10)}`;
const eventKey = (tenant: string, id: string) => `${ROOT}/${enc(tenant)}/ev/${enc(id)}`;
const eventsPrefix = (tenant: string) => `${ROOT}/${enc(tenant)}/ev/`;

const zero = (): Packed => [0, 0, 0, 0, 0];

function packEvent(event: AnalyticsEvent): Packed {
  const p = zero();
  if (event.type === "click") p[event.bot ? 1 : 0] = 1;
  else if (event.type === "lead") p[2] = 1;
  else {
    p[3] = 1;
    p[4] = event.amount;
  }
  return p;
}

function addPacked(a: Packed, b: Packed): void {
  for (let i = 0; i < 5; i++) a[i] = (a[i] as number) + (b[i] as number);
}

const unpack = (p: Packed): AnalyticsMetrics => ({
  clicks: p[0],
  botClicks: p[1],
  leads: p[2],
  sales: p[3],
  saleAmount: p[4],
});

function addToBucket(bucket: RollupBucket, event: AnalyticsEvent, scope: string): void {
  const packed = packEvent(event);
  addPacked(bucket.m, packed);
  for (const dim of ANALYTICS_DIMENSIONS) {
    if (dim === "link" && scope !== TENANT_SCOPE) continue;
    const value = dimensionValue(event, dim);
    const byValue = (bucket.d[dim] ??= {});
    addPacked((byValue[value] ??= zero()), packed);
  }
}

function mergeBucket(into: RollupBucket, delta: RollupBucket): void {
  addPacked(into.m, delta.m);
  for (const [dim, values] of Object.entries(delta.d) as [
    AnalyticsDimension,
    Record<string, Packed>,
  ][]) {
    const target = (into.d[dim] ??= {});
    for (const [value, p] of Object.entries(values)) addPacked((target[value] ??= zero()), p);
  }
}

/**
 * Create the KV rollup sink over a links storage.
 *
 * @example
 * ```ts
 * import { createKvAnalytics } from "@xtandard/links/analytics/kv";
 *
 * const analytics = createKvAnalytics({ storage, hourlyRetention: "30d" });
 * ```
 */
export function createKvAnalytics(options: KvAnalyticsOptions): KvAnalytics {
  const storage = options.storage;
  const hourlyRetentionMs = durationToMs(options.hourlyRetention ?? "14d");
  const dailyRetentionMs =
    options.dailyRetention === undefined ? Infinity : durationToMs(options.dailyRetention);
  const recentEvents = options.recentEvents ?? 1000;
  const now = options.now ?? Date.now;
  let batchesSinceTrim = 0;

  async function applyDelta(key: string, delta: RollupBucket): Promise<void> {
    if (isCompareAndSwap(storage)) {
      for (let i = 0; i < 20; i++) {
        const current = await storage.getItem<RollupBucket>(key);
        const next: RollupBucket = current ? structuredClone(current) : { m: zero(), d: {} };
        mergeBucket(next, delta);
        if (await storage.compareAndSwap<RollupBucket>({ key, expected: current, next })) return;
      }
    }
    const current = (await storage.getItem<RollupBucket>(key)) ?? { m: zero(), d: {} };
    mergeBucket(current, delta);
    await storage.setItem(key, current);
  }

  async function trimEvents(tenant: string): Promise<number> {
    const keys = (await storage.getKeys(eventsPrefix(tenant))).sort();
    const excess = keys.length - recentEvents;
    for (let i = 0; i < excess; i++) await storage.removeItem(keys[i] as string);
    return Math.max(0, excess);
  }

  async function readBucket(
    tenant: string,
    scope: string,
    interval: AnalyticsInterval,
    at: number,
  ): Promise<RollupBucket | null> {
    return storage.getItem<RollupBucket>(bucketKey(tenant, scope, interval, at));
  }

  /** The (interval, start) buckets that cover [from, to): daily inside, hourly at the edges. */
  function coveringBuckets(from: string, to: string): [AnalyticsInterval, number][] {
    const start = bucketStart(Date.parse(from), "hour");
    const end = Date.parse(to);
    const out: [AnalyticsInterval, number][] = [];
    let t = start;
    while (t < end) {
      if (t % 86_400_000 === 0 && t + 86_400_000 <= end) {
        out.push(["day", t]);
        t += 86_400_000;
      } else {
        out.push(["hour", t]);
        t += 3_600_000;
      }
    }
    return out;
  }

  /** Metrics of one bucket under the query's (single-dimension) filter. */
  function filtered(bucket: RollupBucket, filter: [AnalyticsDimension, string[]] | null): Packed {
    if (!filter) return bucket.m;
    const [dim, values] = filter;
    const out = zero();
    const byValue = bucket.d[dim] ?? {};
    for (const v of values) if (byValue[v]) addPacked(out, byValue[v] as Packed);
    return out;
  }

  const capabilities: AnalyticsCapabilities = {
    crossFilter: false,
    uniques: false,
    events: recentEvents > 0,
    intervals: ["hour", "day"],
  };

  const sink: KvAnalytics = {
    capabilities,

    async ingest(events) {
      if (events.length === 0) return;
      const deltas = new Map<string, RollupBucket>();
      const tenants = new Set<string>();
      for (const event of events) {
        tenants.add(event.tenant);
        const t = Date.parse(event.at);
        for (const interval of ["hour", "day"] as const) {
          const start = bucketStart(t, interval);
          for (const scope of [TENANT_SCOPE, linkScope(event.linkId)]) {
            const key = bucketKey(event.tenant, scope, interval, start);
            let delta = deltas.get(key);
            if (!delta) deltas.set(key, (delta = { m: zero(), d: {} }));
            addToBucket(delta, event, scope);
          }
        }
      }
      for (const [key, delta] of deltas) await applyDelta(key, delta);
      if (recentEvents > 0) {
        for (const event of events) await storage.setItem(eventKey(event.tenant, event.id), event);
        if (++batchesSinceTrim >= 20) {
          batchesSinceTrim = 0;
          for (const tenant of tenants) await trimEvents(tenant);
        }
      }
    },

    async query(query: AnalyticsQuery): Promise<AnalyticsResult> {
      const filterEntries = Object.entries(query.filters ?? {}).filter(
        ([dim, values]) => dim !== "link" && values && values.length > 0,
      ) as [AnalyticsDimension, string[]][];
      const linkFilter = query.filters?.link?.length ? query.filters.link : undefined;
      const linkIds =
        query.linkIds && linkFilter
          ? query.linkIds.filter((id) => linkFilter.includes(id))
          : (query.linkIds ?? linkFilter);
      if (filterEntries.length > 1) {
        throw new UnsupportedQueryError(
          "KV rollups support at most one non-link filter dimension; use an OLAP sink for more.",
        );
      }
      const filter = filterEntries[0] ?? null;
      if (filter && query.groupBy && query.groupBy !== filter[0] && query.groupBy !== "link") {
        throw new UnsupportedQueryError(
          `KV rollups cannot group by "${query.groupBy}" while filtering on "${filter[0]}".`,
        );
      }
      if (filter && query.groupBy === "link" && !linkIds) {
        throw new UnsupportedQueryError(
          `KV rollups cannot group by link while filtering on "${filter[0]}" without linkIds.`,
        );
      }
      const scopes = linkIds ? linkIds.map(linkScope) : [TENANT_SCOPE];

      const totals = zero();
      const groups = new Map<string, Packed>();
      const group = (k: string): Packed => {
        let p = groups.get(k);
        if (!p) groups.set(k, (p = zero()));
        return p;
      };
      const accumulate = (bucket: RollupBucket, scope: string) => {
        addPacked(totals, filtered(bucket, filter));
        if (!query.groupBy) return;
        if (query.groupBy === "link" && scope !== TENANT_SCOPE) {
          const p = filtered(bucket, filter);
          if (p.some((x) => x !== 0)) addPacked(group(scope.slice(2)), p);
          return;
        }
        const byValue = bucket.d[query.groupBy] ?? {};
        for (const [value, p] of Object.entries(byValue)) {
          if (filter && filter[0] === query.groupBy && !filter[1].includes(value)) continue;
          addPacked(group(value), p);
        }
      };

      for (const [interval, at] of coveringBuckets(query.from, query.to)) {
        for (const scope of scopes) {
          const bucket = await readBucket(query.tenant, scope, interval, at);
          if (bucket) accumulate(bucket, scope);
        }
      }

      const result: AnalyticsResult = { totals: unpack(totals) };
      if (query.interval) {
        const interval = query.interval;
        result.timeseries = [];
        for (const at of bucketRange(query.from, query.to, interval)) {
          const m = zero();
          for (const scope of scopes) {
            const bucket = await readBucket(query.tenant, scope, interval, at);
            if (bucket) addPacked(m, filtered(bucket, filter));
          }
          result.timeseries.push({ at: new Date(at).toISOString(), ...unpack(m) });
        }
      }
      if (query.groupBy) {
        const rows: AnalyticsBreakdownRow[] = [...groups].map(([key, p]) => ({
          key,
          ...unpack(p),
        }));
        result.breakdown = sortBreakdown(rows, query.limit);
      }
      return result;
    },

    async events(query: EventsQuery): Promise<AnalyticsEvent[]> {
      const limit = Math.min(Math.max(query.limit ?? 50, 1), 1000);
      const keys = (await storage.getKeys(eventsPrefix(query.tenant))).sort().reverse();
      const out: AnalyticsEvent[] = [];
      for (const key of keys) {
        if (out.length >= limit) break;
        const event = await storage.getItem<AnalyticsEvent>(key);
        if (!event) continue;
        if (query.before && event.at >= query.before) continue;
        if (query.linkIds && !query.linkIds.includes(event.linkId)) continue;
        if (query.types && !query.types.includes(event.type)) continue;
        if (!query.includeBots && event.type === "click" && event.bot) continue;
        out.push(event);
      }
      return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1));
    },

    async deleteLink(tenant, linkId) {
      for (const key of await storage.getKeys(
        `${ROOT}/${enc(tenant)}/${enc(linkScope(linkId))}/`,
      )) {
        await storage.removeItem(key);
      }
      for (const key of await storage.getKeys(eventsPrefix(tenant))) {
        const event = await storage.getItem<AnalyticsEvent>(key);
        if (event?.linkId === linkId) await storage.removeItem(key);
      }
    },

    async prune() {
      const at = now();
      let buckets = 0;
      let events = 0;
      for (const key of await storage.getKeys(`${ROOT}/`)) {
        const m = /\/(h|d)\/([0-9T-]+)$/.exec(key);
        if (!m) continue;
        const start = Date.parse(m[1] === "h" ? `${m[2]}:00:00Z` : `${m[2]}T00:00:00Z`);
        const keep = m[1] === "h" ? hourlyRetentionMs : dailyRetentionMs;
        if (start + keep < at) {
          await storage.removeItem(key);
          buckets++;
        }
      }
      if (recentEvents > 0) {
        const tenants = new Set<string>();
        for (const key of await storage.getKeys(`${ROOT}/`)) {
          const m = /^lnk\/rollup\/([^/]+)\/ev\//.exec(key);
          if (m) tenants.add(decodeURIComponent(m[1] as string));
        }
        for (const tenant of tenants) events += await trimEvents(tenant);
      }
      return { buckets, events };
    },
  };
  return sink;
}
