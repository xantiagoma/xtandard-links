/**
 * Tinybird analytics sink — `fetch` only, no peer dependencies.
 *
 * - Ingest: the Events API (`POST /v0/events?name=<datasource>`, NDJSON).
 * - Query: the SQL API (`POST /v0/sql`, `q=` form field). The SQL API has no
 *   bound parameters, so every value is inlined as an escaped string literal
 *   (backslash and quote escaped) or a validated integer.
 * - Data source: create it from {@link tinybirdDatasource} (a `.datasource`
 *   file): one row per event, `MergeTree` sorted by `tenant, at`.
 * - `deleteLink`: the Data Source delete API (`POST /v0/datasources/<name>/delete`),
 *   which runs as an asynchronous job — rows disappear once it completes.
 *
 * The token needs `DATASOURCES:APPEND` (ingest) and `DATASOURCES:READ` (query)
 * on the data source, plus `DATASOURCES:CREATE` for `deleteLink`. Uniques are
 * exact (`uniqExactIf`). Ingestion is eventually consistent unless `wait: true`.
 *
 * @module
 */

import type { AnalyticsEvent } from "../schema.ts";
import type {
  AnalyticsCapabilities,
  AnalyticsQuery,
  AnalyticsResult,
  AnalyticsSink,
  EventsQuery,
} from "./contract.ts";
import {
  buildAnalyticsSql,
  buildEventsSql,
  identifier,
  literalBinder,
  mapAnalyticsRows,
  parseEventRows,
  quoteString,
  readJsonRows,
  TABLE_COLUMNS,
  tableDialect,
  toEventRow,
  type MetricRow,
} from "./sql.ts";

/** Options for {@link createTinybirdAnalytics}. */
export interface TinybirdAnalyticsOptions {
  /** Workspace token (see the module docs for scopes). */
  token: string;
  /** API host for your region. Default `"https://api.tinybird.co"`. */
  baseUrl?: string;
  /** Data source name. Default `"links_events"`. */
  datasource?: string;
  /** Injectable `fetch`. Default `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** Ask the Events API to acknowledge only after the write is committed. Default `false`. */
  wait?: boolean;
}

/** Options for {@link tinybirdDatasource}. */
export interface TinybirdDatasourceOptions {
  /** Optional `TTL` expression, e.g. `"toDateTime(at) + INTERVAL 13 MONTH"`. */
  ttl?: string;
}

/**
 * The `.datasource` file text for the events data source. Save it as
 * `datasources/links_events.datasource` (or your chosen name) and deploy it.
 */
export function tinybirdDatasource(options: TinybirdDatasourceOptions = {}): string {
  const columns = TABLE_COLUMNS.map(
    ([name, type]) => `    \`${name}\` ${type} \`json:$.${name}\``,
  ).join(",\n");
  return (
    `DESCRIPTION >\n    Click, lead and sale events from @xtandard/links.\n\n` +
    `SCHEMA >\n${columns}\n\n` +
    `ENGINE "MergeTree"\n` +
    `ENGINE_PARTITION_KEY "toYYYYMM(at)"\n` +
    `ENGINE_SORTING_KEY "tenant, at"\n` +
    (options.ttl ? `ENGINE_TTL "${options.ttl}"\n` : "")
  );
}

/** The Tinybird sink; `deleteLink` and `events` are always available. */
export interface TinybirdAnalyticsSink extends AnalyticsSink {
  events(query: EventsQuery): Promise<AnalyticsEvent[]>;
  deleteLink(tenant: string, linkId: string): Promise<void>;
}

/**
 * Create a Tinybird-backed {@link AnalyticsSink}.
 *
 * @example
 * ```ts
 * import { createTinybirdAnalytics } from "@xtandard/links/analytics/tinybird";
 *
 * const analytics = createTinybirdAnalytics({
 *   token: process.env.TINYBIRD_TOKEN!,
 *   baseUrl: "https://api.us-east.aws.tinybird.co",
 * });
 * ```
 */
export function createTinybirdAnalytics(options: TinybirdAnalyticsOptions): TinybirdAnalyticsSink {
  const doFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? "https://api.tinybird.co").replace(/\/+$/, "");
  const datasource = identifier(options.datasource ?? "links_events", "datasource");
  const dialect = tableDialect(datasource);
  const auth = { Authorization: `Bearer ${options.token}` };

  const capabilities: AnalyticsCapabilities = {
    crossFilter: true,
    uniques: true,
    events: true,
    intervals: ["hour", "day"],
  };

  async function check(response: Response, what: string): Promise<void> {
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Tinybird ${what} failed (${response.status}): ${text.slice(0, 500)}`);
    }
  }

  async function sql(q: string): Promise<MetricRow[]> {
    const response = await doFetch(`${baseUrl}/v0/sql`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ q }).toString(),
    });
    return readJsonRows(response, "Tinybird query");
  }

  return {
    capabilities,

    async ingest(events) {
      if (events.length === 0) return;
      const url = new URL(`${baseUrl}/v0/events`);
      url.searchParams.set("name", datasource);
      if (options.wait) url.searchParams.set("wait", "true");
      const response = await doFetch(url, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/x-ndjson" },
        body: events.map((e) => JSON.stringify(toEventRow(e))).join("\n"),
      });
      await check(response, "ingest");
    },

    async query(query: AnalyticsQuery): Promise<AnalyticsResult> {
      const statements = buildAnalyticsSql(query, dialect, literalBinder());
      const [totals, timeseries, breakdown] = await Promise.all([
        sql(statements.totals),
        statements.timeseries ? sql(statements.timeseries) : undefined,
        statements.breakdown ? sql(statements.breakdown) : undefined,
      ]);
      return mapAnalyticsRows(query, { totals, timeseries, breakdown }, true);
    },

    async events(query: EventsQuery): Promise<AnalyticsEvent[]> {
      return parseEventRows(await sql(buildEventsSql(query, dialect, literalBinder())));
    },

    async deleteLink(tenant, linkId) {
      const response = await doFetch(`${baseUrl}/v0/datasources/${datasource}/delete`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          delete_condition: `tenant = ${quoteString(tenant)} AND link_id = ${quoteString(linkId)}`,
        }).toString(),
      });
      await check(response, "delete");
    },
  };
}
