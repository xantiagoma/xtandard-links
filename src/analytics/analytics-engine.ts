/**
 * Cloudflare Workers Analytics Engine sink. Writes go through the dataset
 * binding (`writeDataPoint`, non-blocking, inside a Worker); reads go through
 * the Analytics Engine SQL API over `fetch` (anywhere). No peer dependencies.
 * Either half is optional: a redirect Worker may only write, an admin server
 * elsewhere may only read.
 *
 * ## Data point layout
 *
 * | Field      | Content                                                         |
 * | ---------- | --------------------------------------------------------------- |
 * | `index1`   | tenant (the sampling key, so small tenants are never sampled away by big ones; ≤ 96 bytes) |
 * | `blob1`    | event type: `click` / `lead` / `sale`                            |
 * | `blob2`    | event id                                                         |
 * | `blob3`    | link id                                                          |
 * | `blob4`    | domain                                                           |
 * | `blob5`    | slug                                                             |
 * | `blob6`    | country                                                          |
 * | `blob7`    | continent                                                        |
 * | `blob8`    | city                                                             |
 * | `blob9`    | device                                                           |
 * | `blob10`   | os                                                               |
 * | `blob11`   | browser                                                          |
 * | `blob12`   | referrer host                                                    |
 * | `blob13`   | utm_source                                                       |
 * | `blob14`   | utm_medium                                                       |
 * | `blob15`   | utm_campaign                                                     |
 * | `blob16`   | qr (`"true"` / `"false"`)                                        |
 * | `blob17`   | variant                                                          |
 * | `blob18`   | visitor hash                                                     |
 * | `blob19`   | currency (sales)                                                 |
 * | `blob20`   | the full event as JSON (for `events()`; `metadata`, `userAgent` and `referrer` are dropped if the blobs would exceed the 16 KB limit) |
 * | `double1`  | event time, epoch milliseconds                                   |
 * | `double2`  | bot click (`1`) or not (`0`)                                     |
 * | `double3`  | sale amount (minor units)                                        |
 *
 * Dimension blobs hold the dimension value as the reference semantics see it
 * (`"(none)"` when absent). Time filtering and bucketing use `double1` (the
 * event time), not the write `timestamp`.
 *
 * ## Sampling
 *
 * Analytics Engine samples at high volume and records each row's weight in
 * `_sample_interval`, so every count is `SUM(_sample_interval)` (and the sale
 * amount `SUM(double3 * _sample_interval)`): totals are statistically
 * accurate, not exact. For the same reason unique visitors are not reported
 * (`capabilities.uniques = false`) and `events()` returns sampled rows.
 *
 * ## Limits
 *
 * Up to 250 `writeDataPoint` calls per Worker invocation (one per event), data
 * retained for three months, no deletes (so no `deleteLink`). SQL API values
 * are inlined as escaped literals (the API has no bound parameters).
 *
 * @module
 */

import type { AnalyticsEvent } from "../schema.ts";
import {
  dimensionValue,
  type AnalyticsCapabilities,
  type AnalyticsDimension,
  type AnalyticsQuery,
  type AnalyticsResult,
  type AnalyticsSink,
  type EventsQuery,
} from "./contract.ts";
import {
  buildAnalyticsSql,
  buildEventsSql,
  identifier,
  literalBinder,
  mapAnalyticsRows,
  parseEventRows,
  readJsonRows,
  type MetricRow,
  type SqlDialect,
} from "./sql.ts";

/** The Workers Analytics Engine dataset binding (structural; no workers-types needed). */
export interface AnalyticsEngineDataset {
  writeDataPoint(point?: {
    indexes?: (string | ArrayBuffer | null)[];
    blobs?: (string | ArrayBuffer | null)[];
    doubles?: number[];
  }): void;
}

/** Options for {@link createAnalyticsEngine}. */
export interface AnalyticsEngineOptions {
  /** The dataset binding (`env.LINKS_ANALYTICS`). Required for `ingest`. */
  dataset?: AnalyticsEngineDataset;
  /** Cloudflare account id. Required for `query` / `events`. */
  accountId?: string;
  /** API token with `Account Analytics: Read`. Required for `query` / `events`. */
  apiToken?: string;
  /** Dataset name as configured on the binding (letters, digits, `_`). */
  datasetName: string;
  /** Injectable `fetch`. Default `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** API base. Default `"https://api.cloudflare.com/client/v4"`. */
  apiBase?: string;
}

/** Blob column per dimension (see the module docs). */
export const ANALYTICS_ENGINE_BLOBS: Record<AnalyticsDimension, string> = {
  link: "blob3",
  domain: "blob4",
  country: "blob6",
  continent: "blob7",
  city: "blob8",
  device: "blob9",
  os: "blob10",
  browser: "blob11",
  referrer: "blob12",
  utm_source: "blob13",
  utm_medium: "blob14",
  utm_campaign: "blob15",
  qr: "blob16",
  variant: "blob17",
};

/** Total blob bytes allowed per data point. */
const BLOB_LIMIT = 16 * 1024;

const utf8 = new TextEncoder();

/** Map an event to its data point (see the module docs for the layout). */
export function toDataPoint(event: AnalyticsEvent): {
  indexes: string[];
  blobs: string[];
  doubles: number[];
} {
  const dim = (d: AnalyticsDimension) => dimensionValue(event, d);
  const blobs = [
    event.type,
    event.id,
    event.linkId,
    event.domain,
    event.slug,
    dim("country"),
    dim("continent"),
    dim("city"),
    dim("device"),
    dim("os"),
    dim("browser"),
    dim("referrer"),
    dim("utm_source"),
    dim("utm_medium"),
    dim("utm_campaign"),
    dim("qr"),
    dim("variant"),
    (event.type === "click" && event.visitor) || "",
    event.type === "sale" ? event.currency : "",
  ];
  const used = blobs.reduce((n, b) => n + utf8.encode(b).length, 0);
  let json = JSON.stringify(event);
  if (used + utf8.encode(json).length > BLOB_LIMIT) {
    const slim = { ...event } as Partial<Record<string, unknown>>;
    delete slim.metadata;
    delete slim.userAgent;
    delete slim.referrer;
    json = JSON.stringify(slim);
  }
  blobs.push(json);
  return {
    indexes: [event.tenant],
    blobs,
    doubles: [
      Date.parse(event.at),
      event.type === "click" && event.bot ? 1 : 0,
      event.type === "sale" ? event.amount : 0,
    ],
  };
}

/** The SQL dialect over the data point layout. */
export function analyticsEngineDialect(datasetName: string): SqlDialect {
  return {
    table: identifier(datasetName, "datasetName"),
    tenant: "index1",
    type: "blob1",
    id: "blob2",
    isBot: "double2 = 1",
    amount: "double3",
    data: "blob20",
    dims: ANALYTICS_ENGINE_BLOBS,
    weight: "_sample_interval",
    timeRange: (from, to, p) =>
      [
        from === undefined ? undefined : `double1 >= ${p.int(from)}`,
        to === undefined ? undefined : `double1 < ${p.int(to)}`,
      ]
        .filter(Boolean)
        .join(" AND "),
    atMillis: "double1",
    bucket: (interval) => {
      const step = interval === "hour" ? 3_600_000 : 86_400_000;
      return `intDiv(double1, ${step}) * ${step}`;
    },
  };
}

/** The Analytics Engine sink (`events` is available; `deleteLink` is not). */
export interface AnalyticsEngineSink extends AnalyticsSink {
  events(query: EventsQuery): Promise<AnalyticsEvent[]>;
}

/**
 * Create a Workers Analytics Engine-backed {@link AnalyticsSink}.
 *
 * @example
 * ```ts
 * import { createAnalyticsEngine } from "@xtandard/links/analytics/analytics-engine";
 *
 * // In a Worker (wrangler: analytics_engine_datasets = [{ binding = "LINKS", dataset = "links_events" }])
 * const analytics = createAnalyticsEngine({
 *   dataset: env.LINKS,
 *   datasetName: "links_events",
 *   accountId: env.CF_ACCOUNT_ID,
 *   apiToken: env.CF_ANALYTICS_TOKEN,
 * });
 * ```
 */
export function createAnalyticsEngine(options: AnalyticsEngineOptions): AnalyticsEngineSink {
  const doFetch = options.fetch ?? globalThis.fetch;
  const apiBase = (options.apiBase ?? "https://api.cloudflare.com/client/v4").replace(/\/+$/, "");
  const dialect = analyticsEngineDialect(options.datasetName);

  const capabilities: AnalyticsCapabilities = {
    crossFilter: true,
    uniques: false,
    events: true,
    intervals: ["hour", "day"],
  };

  async function sql(statement: string): Promise<MetricRow[]> {
    if (!options.accountId || !options.apiToken) {
      throw new Error("Analytics Engine queries need `accountId` and `apiToken`");
    }
    const response = await doFetch(
      `${apiBase}/accounts/${encodeURIComponent(options.accountId)}/analytics_engine/sql`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiToken}`, "Content-Type": "text/plain" },
        body: statement,
      },
    );
    return readJsonRows(response, "Analytics Engine query");
  }

  return {
    capabilities,

    async ingest(events) {
      if (events.length === 0) return;
      const dataset = options.dataset;
      if (!dataset) throw new Error("Analytics Engine ingest needs the `dataset` binding");
      for (const event of events) dataset.writeDataPoint(toDataPoint(event));
    },

    async query(query: AnalyticsQuery): Promise<AnalyticsResult> {
      const statements = buildAnalyticsSql(query, dialect, literalBinder());
      const [totals, timeseries, breakdown] = await Promise.all([
        sql(statements.totals),
        statements.timeseries ? sql(statements.timeseries) : undefined,
        statements.breakdown ? sql(statements.breakdown) : undefined,
      ]);
      return mapAnalyticsRows(query, { totals, timeseries, breakdown }, false);
    },

    async events(query: EventsQuery): Promise<AnalyticsEvent[]> {
      return parseEventRows(await sql(buildEventsSql(query, dialect, literalBinder())));
    },
  };
}
