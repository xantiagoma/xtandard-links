# ADR 0006 — Analytics Is a Separate Sink Port

**Status:** Accepted (★ new port; no sibling equivalent)

---

## Context

Click volume is orders of magnitude above control data, and its query shape (time series, top-N by
dimension, filters) is OLAP, not KV. Dub uses Tinybird, Sink uses Workers Analytics Engine, Shlink
uses its SQL DB. An embeddable library must work on day one with the host's existing DB and scale
out without a rewrite.

## Decision

1. A separate port, `AnalyticsSink`:

   ```ts
   interface AnalyticsSink {
     ingest(events: AnalyticsEvent[]): Promise<void>; // clicks, leads, sales
     query(query: AnalyticsQuery): Promise<AnalyticsResult>;
     events?(query: EventsQuery): Promise<AnalyticsEvent[]>; // recent raw events (optional)
     close?(): Promise<void>;
   }
   ```

   `AnalyticsQuery` = `{ tenant, linkIds?, domain?, from, to, interval?: "hour" | "day",
groupBy?: Dimension, filters?: Partial<Record<Dimension, string[]>>, limit?, metrics? }` →
   `{ totals, timeseries?, breakdown? }`. Dimensions: link, domain, country, continent, city,
   device, os, browser, referrer, utm_source/medium/campaign, qr, variant.

2. **Default: `createKvAnalytics({ storage })`** — time-bucket rollups in the same KV storage:
   hourly buckets (kept `hourlyRetention`, default 14 days) and daily buckets (forever, or
   `dailyRetention`), per tenant and per link, each carrying metric counters and per-dimension
   counters. Ingest aggregates a batch in memory first, then does one read-modify-write per touched
   bucket (CAS-retried when supported). A bounded recent-events log feeds the "recent clicks" view.
   Limitation (documented): breakdown under a filter on a _different_ dimension is not available
   from rollups (a link filter is); the sink reports `capabilities.crossFilter = false` and the UI
   hides those controls.
3. Adapters for scale, all `fetch`-based (no peer deps): `analytics/clickhouse` (HTTP interface,
   `JSONEachRow` inserts, generated SQL with parameter binding), `analytics/tinybird` (Events API +
   SQL API), `analytics/analytics-engine` (Workers binding `writeDataPoint` + the SQL API).
   `analytics/memory` for tests. Dual-writing during a migration is a few lines of user code
   (a sink whose `ingest` calls both); see docs/ANALYTICS.md.
4. A shared **sink conformance suite** (`test/analytics-contract.ts`) runs against memory, KV (on
   memory storage), and ClickHouse when `CLICKHOUSE_URL` is set (CI service container).

## Consequences

- Day one: zero extra infrastructure. At scale: swap the sink, keep links in Postgres/Redis.
- Unique visitors are only exact in OLAP sinks; KV rollups do not count uniques (documented).
