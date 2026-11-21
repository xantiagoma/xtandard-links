/**
 * ClickHouse analytics sink over the HTTP interface — `fetch` only, no peer
 * dependencies (works on Node, Bun, Deno and edge runtimes).
 *
 * - Ingest: `INSERT INTO <table> FORMAT JSONEachRow`, one request per batch.
 * - Query: generated `SELECT`s whose every user value is a server-side query
 *   parameter (`{p0:String}` + `param_p0=…`), never interpolated into SQL.
 * - Table: one row per event, `MergeTree` ordered by `(tenant, at)`; create it
 *   with {@link clickhouseSchema} or `createTable: true`.
 *
 * Dimension columns store the dimension value as the reference semantics see
 * it (`"(none)"` when absent), so results match `aggregateEvents` exactly;
 * uniques are exact (`uniqExactIf` over the daily visitor hash). `deleteLink`
 * uses a lightweight `DELETE`.
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
  mapAnalyticsRows,
  paramBinder,
  parseEventRows,
  readJsonRows,
  TABLE_COLUMNS,
  tableDialect,
  toEventRow,
  type MetricRow,
} from "./sql.ts";

/** Options for {@link createClickHouseAnalytics}. */
export interface ClickHouseAnalyticsOptions {
  /** HTTP interface URL, e.g. `http://localhost:8123` or `https://xyz.clickhouse.cloud:8443`. */
  url: string;
  /** Database. Default `"default"`. */
  database?: string;
  /** Table. Default `"links_events"`. */
  table?: string;
  /** Default `"default"`. */
  username?: string;
  password?: string;
  /** Injectable `fetch` (tests, custom agents). Default `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** Run `CREATE TABLE IF NOT EXISTS` before the first request. Default `false`. */
  createTable?: boolean;
  /** Table engine used by `createTable`. Default `"MergeTree"`. */
  engine?: string;
  /** Extra ClickHouse settings sent with every request (e.g. `{ async_insert: "1" }`). */
  settings?: Record<string, string>;
}

/** Options for {@link clickhouseSchema}. */
export interface ClickHouseSchemaOptions {
  database?: string;
  table?: string;
  /** Default `"MergeTree"`. Use e.g. `"ReplicatedMergeTree"` for clusters. */
  engine?: string;
}

function tableRef(database: string | undefined, table: string): string {
  const t = `\`${identifier(table, "table")}\``;
  return database ? `\`${identifier(database, "database")}\`.${t}` : t;
}

/**
 * The `CREATE TABLE IF NOT EXISTS` statement for the events table: one row per
 * event, partitioned by month, ordered by `(tenant, at)`.
 */
export function clickhouseSchema(options: ClickHouseSchemaOptions = {}): string {
  const columns = TABLE_COLUMNS.map(
    ([name, type]) => `  ${name} ${type}${name === "data" ? " CODEC(ZSTD(3))" : ""}`,
  ).join(",\n");
  return (
    `CREATE TABLE IF NOT EXISTS ${tableRef(options.database, options.table ?? "links_events")} (\n` +
    `${columns}\n` +
    `) ENGINE = ${options.engine ?? "MergeTree"}\n` +
    `PARTITION BY toYYYYMM(at)\n` +
    `ORDER BY (tenant, at)`
  );
}

/** The ClickHouse sink; `deleteLink` and `events` are always available. */
export interface ClickHouseAnalyticsSink extends AnalyticsSink {
  events(query: EventsQuery): Promise<AnalyticsEvent[]>;
  deleteLink(tenant: string, linkId: string): Promise<void>;
  /** Run `CREATE TABLE IF NOT EXISTS` now. */
  createTable(): Promise<void>;
}

/**
 * Create a ClickHouse-backed {@link AnalyticsSink}.
 *
 * @example
 * ```ts
 * import { createClickHouseAnalytics } from "@xtandard/links/analytics/clickhouse";
 *
 * const analytics = createClickHouseAnalytics({
 *   url: process.env.CLICKHOUSE_URL!,
 *   username: "links",
 *   password: process.env.CLICKHOUSE_PASSWORD,
 *   createTable: true,
 * });
 * ```
 */
export function createClickHouseAnalytics(
  options: ClickHouseAnalyticsOptions,
): ClickHouseAnalyticsSink {
  const doFetch = options.fetch ?? globalThis.fetch;
  const database = options.database ?? "default";
  const table = tableRef(undefined, options.table ?? "links_events");
  const dialect = tableDialect(table);
  const headers: Record<string, string> = {
    "X-ClickHouse-User": options.username ?? "default",
  };
  if (options.password !== undefined) headers["X-ClickHouse-Key"] = options.password;

  const capabilities: AnalyticsCapabilities = {
    crossFilter: true,
    uniques: true,
    events: true,
    intervals: ["hour", "day"],
  };

  async function request(
    sql: string,
    params: Record<string, string> = {},
    body?: string,
  ): Promise<Response> {
    const url = new URL(options.url);
    url.searchParams.set("database", identifier(database, "database"));
    for (const [k, v] of Object.entries(options.settings ?? {})) url.searchParams.set(k, v);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(`param_${k}`, v);
    // With a body (INSERT data), the statement travels in `query=`; otherwise in the body.
    if (body !== undefined) url.searchParams.set("query", sql);
    const response = await doFetch(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
      body: body ?? sql,
    });
    return response;
  }

  async function exec(sql: string, params?: Record<string, string>, body?: string) {
    const response = await request(sql, params, body);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`ClickHouse request failed (${response.status}): ${text.slice(0, 500)}`);
    }
  }

  async function select(sql: string, params: Record<string, string>): Promise<MetricRow[]> {
    return readJsonRows(await request(sql, params), "ClickHouse query");
  }

  let ready: Promise<void> | undefined;
  const createTable = () =>
    exec(clickhouseSchema({ table: options.table ?? "links_events", engine: options.engine }));
  const ensure = (): Promise<void> => {
    if (!options.createTable) return Promise.resolve();
    ready ??= createTable().catch((error: unknown) => {
      ready = undefined;
      throw error;
    });
    return ready;
  };

  return {
    capabilities,

    createTable,

    async ingest(events) {
      if (events.length === 0) return;
      await ensure();
      const body = events.map((e) => JSON.stringify(toEventRow(e))).join("\n");
      const columns = TABLE_COLUMNS.map(([name]) => name).join(", ");
      await exec(`INSERT INTO ${table} (${columns}) FORMAT JSONEachRow`, {}, body);
    },

    async query(query: AnalyticsQuery): Promise<AnalyticsResult> {
      await ensure();
      const p = paramBinder();
      const sql = buildAnalyticsSql(query, dialect, p);
      const [totals, timeseries, breakdown] = await Promise.all([
        select(sql.totals, p.params),
        sql.timeseries ? select(sql.timeseries, p.params) : undefined,
        sql.breakdown ? select(sql.breakdown, p.params) : undefined,
      ]);
      return mapAnalyticsRows(query, { totals, timeseries, breakdown }, true);
    },

    async events(query: EventsQuery): Promise<AnalyticsEvent[]> {
      await ensure();
      const p = paramBinder();
      return parseEventRows(await select(buildEventsSql(query, dialect, p), p.params));
    },

    async deleteLink(tenant, linkId) {
      await ensure();
      const p = paramBinder();
      await exec(
        `DELETE FROM ${table} WHERE tenant = ${p.str(tenant)} AND link_id = ${p.str(linkId)}`,
        p.params,
      );
    },
  };
}
