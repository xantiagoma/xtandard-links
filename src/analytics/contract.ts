/**
 * The analytics sink port (ADR 0006). Clicks, leads and sales flow into an
 * {@link AnalyticsSink}; the admin API and the analytics widget read back
 * through {@link AnalyticsSink.query}. Storage for links never sees click
 * traffic except through the default KV rollup sink.
 *
 * Implementations: `analytics/kv` (rollups in the links storage — the
 * default), `analytics/memory` (tests), `analytics/clickhouse`,
 * `analytics/tinybird`, `analytics/analytics-engine`. Every implementation
 * must pass the shared conformance suite.
 *
 * @module
 */

import type { AnalyticsEvent } from "../schema.ts";

/** Dimensions an analytics query can group or filter by. */
export type AnalyticsDimension =
  | "link"
  | "domain"
  | "country"
  | "continent"
  | "city"
  | "device"
  | "os"
  | "browser"
  | "referrer"
  | "utm_source"
  | "utm_medium"
  | "utm_campaign"
  | "qr"
  | "variant";

/** Every dimension, in display order. */
export const ANALYTICS_DIMENSIONS: readonly AnalyticsDimension[] = [
  "link",
  "domain",
  "country",
  "continent",
  "city",
  "device",
  "os",
  "browser",
  "referrer",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "qr",
  "variant",
];

/** Counters reported for every bucket and breakdown row. */
export interface AnalyticsMetrics {
  /** Non-bot clicks. */
  clicks: number;
  /** Clicks flagged as bots (only counted, never in `clicks`). */
  botClicks: number;
  leads: number;
  sales: number;
  /** Sum of sale amounts in minor units (mixed currencies are summed as-is; see `currency` breakdowns). */
  saleAmount: number;
  /** Unique visitors, when the sink can count them (`capabilities.uniques`). */
  uniques?: number;
}

/** Time bucket size for timeseries. */
export type AnalyticsInterval = "hour" | "day";

/** An analytics query, always scoped to one tenant. */
export interface AnalyticsQuery {
  tenant: string;
  /** Inclusive ISO-8601 start. */
  from: string;
  /** Exclusive ISO-8601 end. */
  to: string;
  /** Restrict to these links. */
  linkIds?: string[];
  /** Equality filters (value in list) on dimensions. */
  filters?: Partial<Record<AnalyticsDimension, string[]>>;
  /** When set, `timeseries` is returned with buckets of this size (UTC). */
  interval?: AnalyticsInterval;
  /** When set, `breakdown` is returned grouped by this dimension. */
  groupBy?: AnalyticsDimension;
  /** Max breakdown rows (sorted by clicks desc, then key asc). Default 10. */
  limit?: number;
}

/** One timeseries bucket. */
export interface AnalyticsBucket extends AnalyticsMetrics {
  /** ISO-8601 bucket start (UTC, aligned to the interval). */
  at: string;
}

/** One breakdown row. */
export interface AnalyticsBreakdownRow extends AnalyticsMetrics {
  /** Dimension value (`"US"`, `"mobile"`, link id, …); `"(none)"` when absent. */
  key: string;
}

/** Result of {@link AnalyticsSink.query}. */
export interface AnalyticsResult {
  totals: AnalyticsMetrics;
  /** Present iff `interval` was requested; contiguous, zero-filled, ascending. */
  timeseries?: AnalyticsBucket[];
  /** Present iff `groupBy` was requested. */
  breakdown?: AnalyticsBreakdownRow[];
}

/** Query for raw recent events. */
export interface EventsQuery {
  tenant: string;
  linkIds?: string[];
  types?: AnalyticsEvent["type"][];
  /** Exclusive upper bound (ISO-8601) for paging backwards. */
  before?: string;
  /** Default 50. */
  limit?: number;
  /** Include bot clicks. Default false. */
  includeBots?: boolean;
}

/** What a sink can do; the UI and API adapt to it. */
export interface AnalyticsCapabilities {
  /** Filters on one dimension combine with grouping by another. */
  crossFilter: boolean;
  /** `uniques` is populated. */
  uniques: boolean;
  /** `events()` is implemented. */
  events: boolean;
  /** Finest timeseries granularity retained for the whole range. */
  intervals: AnalyticsInterval[];
}

/** The analytics port. */
export interface AnalyticsSink {
  readonly capabilities: AnalyticsCapabilities;
  /** Persist a batch of events. Must be safe to call concurrently. */
  ingest(events: readonly AnalyticsEvent[]): Promise<void>;
  /** Aggregate. Bot clicks never count toward `clicks`. */
  query(query: AnalyticsQuery): Promise<AnalyticsResult>;
  /** Most recent events first. */
  events?(query: EventsQuery): Promise<AnalyticsEvent[]>;
  /** Drop events for a link (link deletion with `purgeAnalytics`). Optional. */
  deleteLink?(tenant: string, linkId: string): Promise<void>;
  /** Flush and release resources. */
  close?(): Promise<void>;
}

/** Zero-valued metrics. */
export function emptyMetrics(): AnalyticsMetrics {
  return { clicks: 0, botClicks: 0, leads: 0, sales: 0, saleAmount: 0 };
}

/** Add `event` to `metrics` in place. */
export function addEventToMetrics(metrics: AnalyticsMetrics, event: AnalyticsEvent): void {
  if (event.type === "click") {
    if (event.bot) metrics.botClicks++;
    else metrics.clicks++;
  } else if (event.type === "lead") metrics.leads++;
  else {
    metrics.sales++;
    metrics.saleAmount += event.amount;
  }
}

/** Add `b` into `a` in place. */
export function addMetrics(a: AnalyticsMetrics, b: AnalyticsMetrics): void {
  a.clicks += b.clicks;
  a.botClicks += b.botClicks;
  a.leads += b.leads;
  a.sales += b.sales;
  a.saleAmount += b.saleAmount;
  if (b.uniques !== undefined) a.uniques = (a.uniques ?? 0) + b.uniques;
}

/** Value used for events that lack a dimension. */
export const NONE_KEY = "(none)";

/**
 * The value of `dimension` on `event` (`"(none)"` when absent). Lead and sale
 * events only carry `link` and `domain`; other dimensions read `"(none)"`.
 */
export function dimensionValue(event: AnalyticsEvent, dimension: AnalyticsDimension): string {
  switch (dimension) {
    case "link":
      return event.linkId;
    case "domain":
      return event.domain;
  }
  if (event.type !== "click") return NONE_KEY;
  switch (dimension) {
    case "country":
      return event.country ?? NONE_KEY;
    case "continent":
      return event.continent ?? NONE_KEY;
    case "city":
      return event.city ?? NONE_KEY;
    case "device":
      return event.device;
    case "os":
      return event.os;
    case "browser":
      return event.browser;
    case "referrer":
      return event.referrerHost;
    case "utm_source":
      return event.utm?.source ?? NONE_KEY;
    case "utm_medium":
      return event.utm?.medium ?? NONE_KEY;
    case "utm_campaign":
      return event.utm?.campaign ?? NONE_KEY;
    case "qr":
      return event.qr ? "true" : "false";
    case "variant":
      return event.variant ?? NONE_KEY;
  }
}

/** Align an epoch-millis timestamp down to the interval start (UTC). */
export function bucketStart(millis: number, interval: AnalyticsInterval): number {
  const step = interval === "hour" ? 3_600_000 : 86_400_000;
  return Math.floor(millis / step) * step;
}

/** Every bucket start in `[from, to)` for the interval, ascending. */
export function bucketRange(from: string, to: string, interval: AnalyticsInterval): number[] {
  const step = interval === "hour" ? 3_600_000 : 86_400_000;
  const out: number[] = [];
  const end = Date.parse(to);
  for (let t = bucketStart(Date.parse(from), interval); t < end; t += step) out.push(t);
  return out;
}

/** Sort + truncate breakdown rows: clicks desc, then leads, sales, key asc. */
export function sortBreakdown(rows: AnalyticsBreakdownRow[], limit = 10): AnalyticsBreakdownRow[] {
  return rows
    .sort(
      (a, b) =>
        b.clicks - a.clicks ||
        b.leads - a.leads ||
        b.sales - a.sales ||
        b.saleAmount - a.saleAmount ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    )
    .slice(0, limit);
}

/** Whether `event` passes the query's scope (tenant, time, links, filters). */
export function matchesQuery(
  event: AnalyticsEvent,
  query: Pick<AnalyticsQuery, "tenant" | "from" | "to" | "linkIds" | "filters">,
): boolean {
  if (event.tenant !== query.tenant) return false;
  const t = Date.parse(event.at);
  if (t < Date.parse(query.from) || t >= Date.parse(query.to)) return false;
  if (query.linkIds && !query.linkIds.includes(event.linkId)) return false;
  if (query.filters) {
    for (const [dim, values] of Object.entries(query.filters) as [
      AnalyticsDimension,
      string[] | undefined,
    ][]) {
      if (values && values.length > 0 && !values.includes(dimensionValue(event, dim))) return false;
    }
  }
  return true;
}

/**
 * Reference aggregation over an in-memory event list — the semantics every
 * sink must reproduce (the memory sink is exactly this).
 */
export function aggregateEvents(
  events: Iterable<AnalyticsEvent>,
  query: AnalyticsQuery,
): AnalyticsResult {
  const totals = emptyMetrics();
  const series = query.interval
    ? new Map(bucketRange(query.from, query.to, query.interval).map((t) => [t, emptyMetrics()]))
    : undefined;
  const groups = query.groupBy ? new Map<string, AnalyticsMetrics>() : undefined;
  for (const event of events) {
    if (!matchesQuery(event, query)) continue;
    addEventToMetrics(totals, event);
    if (series && query.interval) {
      const bucket = series.get(bucketStart(Date.parse(event.at), query.interval));
      if (bucket) addEventToMetrics(bucket, event);
    }
    if (groups && query.groupBy) {
      const key = dimensionValue(event, query.groupBy);
      let m = groups.get(key);
      if (!m) groups.set(key, (m = emptyMetrics()));
      addEventToMetrics(m, event);
    }
  }
  const result: AnalyticsResult = { totals };
  if (series) {
    result.timeseries = [...series].map(([t, m]) => ({ at: new Date(t).toISOString(), ...m }));
  }
  if (groups) {
    result.breakdown = sortBreakdown(
      [...groups].map(([key, m]) => ({ key, ...m })),
      query.limit,
    );
  }
  return result;
}
