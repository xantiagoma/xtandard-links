/**
 * Shared SQL generation for the ClickHouse-dialect sinks (ClickHouse,
 * Tinybird, Workers Analytics Engine). Each adapter supplies a
 * {@link SqlDialect} (column expressions, sampling weight, time handling) and a
 * {@link SqlBinder} (query parameters or escaped literals); this module builds
 * the statements and maps rows back to an {@link AnalyticsResult} with the
 * exact semantics of {@link aggregateEvents}.
 *
 * Internal — not a public subpath.
 *
 * @module
 */

import type { AnalyticsEvent } from "../schema.ts";
import {
  ANALYTICS_DIMENSIONS,
  bucketRange,
  dimensionValue,
  emptyMetrics,
  sortBreakdown,
  type AnalyticsDimension,
  type AnalyticsInterval,
  type AnalyticsMetrics,
  type AnalyticsQuery,
  type AnalyticsResult,
  type EventsQuery,
} from "./contract.ts";

/** How values get into a statement: bound parameters or escaped literals. */
export interface SqlBinder {
  str(value: string): string;
  /** A safe integer (epoch millis, counts). */
  int(value: number): string;
  /** A list for `IN`; never called with an empty list. */
  strList(values: readonly string[]): string;
}

/** Column expressions and engine quirks for one backend. */
export interface SqlDialect {
  /** Quoted table reference. */
  table: string;
  tenant: string;
  type: string;
  id: string;
  /** Expression truthy for bot clicks (`bot = 1`). */
  isBot: string;
  amount: string;
  /** Column holding the full event JSON. */
  data: string;
  /** Column per dimension, holding {@link dimensionValue}. */
  dims: Record<AnalyticsDimension, string>;
  /** Row weight: `1`, or `_sample_interval` for sampled stores. */
  weight: string;
  /** `[from, to)` time predicate (epoch millis). */
  timeRange(fromMs: number | undefined, toMs: number | undefined, p: SqlBinder): string;
  /** Expression yielding the event time in epoch millis (for ordering). */
  atMillis: string;
  /** Expression yielding the bucket start in epoch millis. */
  bucket(interval: AnalyticsInterval): string;
  /** Distinct-visitor expression, when the backend counts uniques. */
  uniques?: string;
}

/** Validate an identifier (database / table / datasource name). */
export function identifier(name: string, what = "identifier"): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid ${what} ${JSON.stringify(name)}: use letters, digits and _`);
  }
  return name;
}

/** Escape a string as a ClickHouse single-quoted literal. */
export function quoteString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function safeInt(value: number): number {
  if (!Number.isSafeInteger(value)) throw new Error(`Expected an integer, got ${value}`);
  return value;
}

/** A binder that inlines escaped literals (Tinybird SQL API, Analytics Engine). */
export function literalBinder(): SqlBinder {
  return {
    str: quoteString,
    int: (v) => String(safeInt(v)),
    strList: (values) => `(${values.map(quoteString).join(", ")})`,
  };
}

/** A binder that emits ClickHouse `{name:Type}` placeholders and collects their values. */
export function paramBinder(): SqlBinder & { params: Record<string, string> } {
  const params: Record<string, string> = {};
  let n = 0;
  const add = (type: string, value: string) => {
    const name = `p${n++}`;
    params[name] = value;
    return `{${name}:${type}}`;
  };
  // Array parameter values use the ClickHouse text format: ['a', 'b'] with escaped quotes.
  return {
    params,
    str: (v) => add("String", v),
    int: (v) => add("Int64", String(safeInt(v))),
    strList: (vs) => add("Array(String)", `[${vs.map(quoteString).join(",")}]`),
  };
}

function parseTime(value: string, what: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`Invalid ${what} time ${JSON.stringify(value)}`);
  return ms;
}

/** `WHERE` predicates shared by aggregates (tenant, time, links, filters). */
function whereClause(query: AnalyticsQuery, d: SqlDialect, p: SqlBinder): string {
  const parts = [
    `${d.tenant} = ${p.str(query.tenant)}`,
    d.timeRange(parseTime(query.from, "from"), parseTime(query.to, "to"), p),
  ];
  if (query.linkIds) {
    parts.push(query.linkIds.length ? `${d.dims.link} IN ${p.strList(query.linkIds)}` : "0 = 1");
  }
  for (const dim of ANALYTICS_DIMENSIONS) {
    const values = query.filters?.[dim];
    if (values && values.length > 0) parts.push(`${d.dims[dim]} IN ${p.strList(values)}`);
  }
  return parts.join(" AND ");
}

function metricColumns(d: SqlDialect): string {
  const w = d.weight;
  const click = `${d.type} = 'click'`;
  const cols = [
    `SUM(if(${click} AND NOT (${d.isBot}), ${w}, 0)) AS clicks`,
    `SUM(if(${click} AND ${d.isBot}, ${w}, 0)) AS bot_clicks`,
    `SUM(if(${d.type} = 'lead', ${w}, 0)) AS leads`,
    `SUM(if(${d.type} = 'sale', ${w}, 0)) AS sales`,
    `SUM(if(${d.type} = 'sale', ${d.amount} * ${w}, 0)) AS sale_amount`,
  ];
  if (d.uniques) cols.push(`${d.uniques} AS uniques`);
  return cols.join(", ");
}

/** The statements needed to answer one {@link AnalyticsQuery}. */
export interface AnalyticsStatements {
  totals: string;
  timeseries?: string;
  breakdown?: string;
}

/** Build the totals / timeseries / breakdown statements for `query`. */
export function buildAnalyticsSql(
  query: AnalyticsQuery,
  d: SqlDialect,
  p: SqlBinder,
): AnalyticsStatements {
  const where = whereClause(query, d, p);
  const metrics = metricColumns(d);
  const out: AnalyticsStatements = {
    totals: `SELECT ${metrics} FROM ${d.table} WHERE ${where} FORMAT JSON`,
  };
  if (query.interval) {
    out.timeseries =
      `SELECT ${d.bucket(query.interval)} AS t, ${metrics} FROM ${d.table} WHERE ${where} ` +
      `GROUP BY t ORDER BY t FORMAT JSON`;
  }
  if (query.groupBy) {
    const limit = Math.max(0, Math.floor(query.limit ?? 10));
    out.breakdown =
      `SELECT ${d.dims[query.groupBy]} AS k, ${metrics} FROM ${d.table} WHERE ${where} ` +
      `GROUP BY k ORDER BY clicks DESC, leads DESC, sales DESC, sale_amount DESC, k ASC ` +
      `LIMIT ${limit} FORMAT JSON`;
  }
  return out;
}

/** A row of metric aliases as returned by `FORMAT JSON` (64-bit ints may be strings). */
export type MetricRow = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function toMetrics(row: MetricRow | undefined, uniques: boolean): AnalyticsMetrics {
  const m = emptyMetrics();
  if (row) {
    m.clicks = num(row.clicks);
    m.botClicks = num(row.bot_clicks);
    m.leads = num(row.leads);
    m.sales = num(row.sales);
    m.saleAmount = num(row.sale_amount);
  }
  if (uniques) m.uniques = num(row?.uniques);
  return m;
}

/** Map statement results back to an {@link AnalyticsResult} (zero-fills, sorts, truncates). */
export function mapAnalyticsRows(
  query: AnalyticsQuery,
  rows: { totals: MetricRow[]; timeseries?: MetricRow[]; breakdown?: MetricRow[] },
  uniques: boolean,
): AnalyticsResult {
  const result: AnalyticsResult = { totals: toMetrics(rows.totals[0], uniques) };
  if (query.interval) {
    const byBucket = new Map<number, MetricRow>();
    for (const row of rows.timeseries ?? []) byBucket.set(num(row.t), row);
    result.timeseries = bucketRange(query.from, query.to, query.interval).map((t) => ({
      at: new Date(t).toISOString(),
      ...toMetrics(byBucket.get(t), uniques),
    }));
  }
  if (query.groupBy) {
    result.breakdown = sortBreakdown(
      (rows.breakdown ?? []).map((row) => ({ key: String(row.k), ...toMetrics(row, uniques) })),
      Math.max(0, Math.floor(query.limit ?? 10)),
    );
  }
  return result;
}

/** Build the `events()` statement (newest first). */
export function buildEventsSql(query: EventsQuery, d: SqlDialect, p: SqlBinder): string {
  const parts = [`${d.tenant} = ${p.str(query.tenant)}`];
  if (query.before !== undefined) {
    parts.push(d.timeRange(undefined, parseTime(query.before, "before"), p));
  }
  if (query.linkIds) {
    parts.push(query.linkIds.length ? `${d.dims.link} IN ${p.strList(query.linkIds)}` : "0 = 1");
  }
  if (query.types) {
    parts.push(query.types.length ? `${d.type} IN ${p.strList(query.types)}` : "0 = 1");
  }
  if (!query.includeBots) parts.push(`NOT (${d.isBot})`);
  const limit = Math.max(0, Math.floor(query.limit ?? 50));
  return (
    `SELECT ${d.data} AS data FROM ${d.table} WHERE ${parts.join(" AND ")} ` +
    `ORDER BY ${d.atMillis} DESC, ${d.id} DESC LIMIT ${limit} FORMAT JSON`
  );
}

/** Format epoch millis as `YYYY-MM-DD hh:mm:ss.sss` (UTC), the DateTime64 text format. */
export function dateTime64(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}

/** One row of the ClickHouse / Tinybird events table. */
export interface EventRow {
  tenant: string;
  at: string;
  type: AnalyticsEvent["type"];
  id: string;
  link_id: string;
  domain: string;
  slug: string;
  country: string;
  continent: string;
  city: string;
  device: string;
  os: string;
  browser: string;
  referrer: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  qr: string;
  variant: string;
  bot: number;
  visitor: string;
  amount: number;
  currency: string;
  data: string;
}

/** Column name per dimension in the ClickHouse / Tinybird table. */
export const TABLE_DIMENSION_COLUMNS: Record<AnalyticsDimension, string> = {
  link: "link_id",
  domain: "domain",
  country: "country",
  continent: "continent",
  city: "city",
  device: "device",
  os: "os",
  browser: "browser",
  referrer: "referrer",
  utm_source: "utm_source",
  utm_medium: "utm_medium",
  utm_campaign: "utm_campaign",
  qr: "qr",
  variant: "variant",
};

/**
 * Flatten an event into a table row. Dimension columns hold
 * {@link dimensionValue} (so `"(none)"` for absent values), which makes SQL
 * grouping and filtering match the reference semantics exactly; `data` keeps
 * the full event for `events()`.
 */
export function toEventRow(event: AnalyticsEvent): EventRow {
  const dim = (d: AnalyticsDimension) => dimensionValue(event, d);
  return {
    tenant: event.tenant,
    at: dateTime64(parseTime(event.at, "event")),
    type: event.type,
    id: event.id,
    link_id: event.linkId,
    domain: event.domain,
    slug: event.slug,
    country: dim("country"),
    continent: dim("continent"),
    city: dim("city"),
    device: dim("device"),
    os: dim("os"),
    browser: dim("browser"),
    referrer: dim("referrer"),
    utm_source: dim("utm_source"),
    utm_medium: dim("utm_medium"),
    utm_campaign: dim("utm_campaign"),
    qr: dim("qr"),
    variant: dim("variant"),
    bot: event.type === "click" && event.bot ? 1 : 0,
    visitor: (event.type === "click" && event.visitor) || "",
    amount: event.type === "sale" ? event.amount : 0,
    currency: event.type === "sale" ? event.currency : "",
    data: JSON.stringify(event),
  };
}

/** The ClickHouse-dialect dialect over the {@link EventRow} table. */
export function tableDialect(table: string): SqlDialect {
  return {
    table,
    tenant: "tenant",
    type: "type",
    id: "id",
    isBot: "bot = 1",
    amount: "amount",
    data: "data",
    dims: TABLE_DIMENSION_COLUMNS,
    weight: "1",
    timeRange: (from, to, p) =>
      [
        from === undefined ? undefined : `at >= fromUnixTimestamp64Milli(${p.int(from)}, 'UTC')`,
        to === undefined ? undefined : `at < fromUnixTimestamp64Milli(${p.int(to)}, 'UTC')`,
      ]
        .filter(Boolean)
        .join(" AND "),
    atMillis: "toUnixTimestamp64Milli(at)",
    bucket: (interval) => {
      const step = interval === "hour" ? 3_600_000 : 86_400_000;
      return `intDiv(toUnixTimestamp64Milli(at), ${step}) * ${step}`;
    },
    uniques: "uniqExactIf(visitor, type = 'click' AND bot = 0 AND visitor != '')",
  };
}

/** Column list + types of the events table, shared by the DDL helpers. */
export const TABLE_COLUMNS: readonly [name: keyof EventRow, type: string][] = [
  ["tenant", "LowCardinality(String)"],
  ["at", "DateTime64(3, 'UTC')"],
  ["type", "LowCardinality(String)"],
  ["id", "String"],
  ["link_id", "String"],
  ["domain", "LowCardinality(String)"],
  ["slug", "String"],
  ["country", "LowCardinality(String)"],
  ["continent", "LowCardinality(String)"],
  ["city", "String"],
  ["device", "LowCardinality(String)"],
  ["os", "LowCardinality(String)"],
  ["browser", "LowCardinality(String)"],
  ["referrer", "String"],
  ["utm_source", "String"],
  ["utm_medium", "String"],
  ["utm_campaign", "String"],
  ["qr", "LowCardinality(String)"],
  ["variant", "String"],
  ["bot", "UInt8"],
  ["visitor", "String"],
  ["amount", "Int64"],
  ["currency", "LowCardinality(String)"],
  ["data", "String"],
];

/** Parse the `data` column of `events()` rows. */
export function parseEventRows(rows: MetricRow[]): AnalyticsEvent[] {
  return rows.map((row) => JSON.parse(String(row.data)) as AnalyticsEvent);
}

/** Read a `FORMAT JSON` response body (`{ meta, data, rows }`). */
export async function readJsonRows(response: Response, what: string): Promise<MetricRow[]> {
  const text = await response.text();
  if (!response.ok) throw new Error(`${what} failed (${response.status}): ${text.slice(0, 500)}`);
  const body = JSON.parse(text) as { data?: MetricRow[] };
  return body.data ?? [];
}
