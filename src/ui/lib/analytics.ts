/**
 * Analytics view model: date-range presets, interval choice and what the
 * configured sink can answer (`capabilities.crossFilter`). Pure — unit-tested
 * in `test/ui-lib.test.ts`.
 *
 * @module
 */

import type {
  AnalyticsCapabilities,
  AnalyticsDimension,
  AnalyticsInterval,
  AnalyticsMetrics,
} from "../../analytics/contract.ts";

export type RangePreset = "24h" | "7d" | "30d" | "90d";

export const RANGE_PRESETS: { value: RangePreset; label: string; long: string }[] = [
  { value: "24h", label: "24h", long: "Last 24 hours" },
  { value: "7d", label: "7d", long: "Last 7 days" },
  { value: "30d", label: "30d", long: "Last 30 days" },
  { value: "90d", label: "90d", long: "Last 90 days" },
];

const HOUR = 3_600_000;
const DAY = 86_400_000;
const PRESET_MS: Record<RangePreset, number> = {
  "24h": DAY,
  "7d": 7 * DAY,
  "30d": 30 * DAY,
  "90d": 90 * DAY,
};

export function isRangePreset(value: unknown): value is RangePreset {
  return value === "24h" || value === "7d" || value === "30d" || value === "90d";
}

/** Intervals that make sense for a preset (hourly only up to a week). */
export function intervalsFor(preset: RangePreset, caps?: Pick<AnalyticsCapabilities, "intervals">) {
  const wanted: AnalyticsInterval[] =
    preset === "24h" ? ["hour"] : preset === "7d" ? ["day", "hour"] : ["day"];
  const supported = caps?.intervals ?? ["hour", "day"];
  const out = wanted.filter((i) => supported.includes(i));
  return out.length ? out : supported.slice(0, 1);
}

/** The default interval for a preset (first of {@link intervalsFor}). */
export function defaultInterval(
  preset: RangePreset,
  caps?: Pick<AnalyticsCapabilities, "intervals">,
): AnalyticsInterval {
  return intervalsFor(preset, caps)[0] ?? "day";
}

/**
 * `[from, to)` for a preset ending now. `to` is rounded **up** to the next
 * bucket boundary of `interval` so the current (partial) bucket is included
 * and the range is stable for caching within that bucket; `from` keeps the
 * preset's length so the series has exactly N buckets.
 */
export function rangeFor(
  preset: RangePreset,
  interval: AnalyticsInterval,
  now: number = Date.now(),
): { from: string; to: string } {
  const step = interval === "hour" ? HOUR : DAY;
  const to = Math.ceil((now + 1) / step) * step;
  const from = to - PRESET_MS[preset];
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

/** The same-length range immediately before `range` (period-over-period comparison). */
export function previousRange(range: { from: string; to: string }): { from: string; to: string } {
  const from = Date.parse(range.from);
  const to = Date.parse(range.to);
  return { from: new Date(from - (to - from)).toISOString(), to: range.from };
}

export type Filters = Partial<Record<AnalyticsDimension, string[]>>;

/** Non-empty filter entries, in a stable order. */
export function filterEntries(filters: Filters): [AnalyticsDimension, string[]][] {
  return (Object.entries(filters) as [AnalyticsDimension, string[] | undefined][])
    .filter((e): e is [AnalyticsDimension, string[]] => !!e[1] && e[1].length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Whether the sink can answer a breakdown query. Sinks with `crossFilter`
 * answer anything; the KV rollups take at most one non-link filter, and only
 * group by that same dimension (or by link when the query names its links).
 */
export function canQuery(
  caps: Pick<AnalyticsCapabilities, "crossFilter">,
  query: { groupBy?: AnalyticsDimension; filters?: Filters; linkIds?: string[] },
): boolean {
  if (caps.crossFilter) return true;
  const active = filterEntries(query.filters ?? {}).filter(([d]) => d !== "link");
  if (active.length > 1) return false;
  const only = active[0];
  if (!only || !query.groupBy) return true;
  if (query.groupBy === only[0]) return true;
  return query.groupBy === "link" && !!query.linkIds?.length;
}

/**
 * Toggle `value` in the filter for `dim`. Without `crossFilter` the sink takes
 * a single non-link filter dimension, so picking a value on another dimension
 * replaces the previous filter instead of combining with it.
 */
export function toggleFilter(
  filters: Filters,
  dim: AnalyticsDimension,
  value: string,
  caps: Pick<AnalyticsCapabilities, "crossFilter">,
): Filters {
  const current = filters[dim] ?? [];
  const nextValues = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
  const base: Filters = caps.crossFilter || dim === "link" ? { ...filters } : pickLink(filters);
  if (nextValues.length) base[dim] = nextValues;
  else delete base[dim];
  return base;
}

function pickLink(filters: Filters): Filters {
  return filters.link?.length ? { link: filters.link } : {};
}

/** Encode filters for the URL (`country:US,DE;device:mobile`). */
export function encodeFilters(filters: Filters): string {
  return filterEntries(filters)
    .map(([d, v]) => `${d}:${v.map(encodeURIComponent).join(",")}`)
    .join(";");
}

/** Inverse of {@link encodeFilters}; ignores malformed parts. */
export function decodeFilters(raw: string | null | undefined, known: readonly string[]): Filters {
  const out: Filters = {};
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const i = part.indexOf(":");
    if (i <= 0) continue;
    const dim = part.slice(0, i) as AnalyticsDimension;
    if (!known.includes(dim)) continue;
    const values = part
      .slice(i + 1)
      .split(",")
      .filter(Boolean)
      .map((v) => {
        try {
          return decodeURIComponent(v);
        } catch {
          return v;
        }
      });
    if (values.length) out[dim] = values;
  }
  return out;
}

/** The metrics the KPI tiles and chart can show. */
export type MetricKey = "clicks" | "uniques" | "leads" | "sales" | "saleAmount";

/** Metrics available given the sink's capabilities. */
export function availableMetrics(caps: Pick<AnalyticsCapabilities, "uniques">): MetricKey[] {
  return caps.uniques
    ? ["clicks", "uniques", "leads", "sales", "saleAmount"]
    : ["clicks", "leads", "sales", "saleAmount"];
}

/** A metric's value (missing uniques read as 0). */
export function metricValue(m: AnalyticsMetrics, key: MetricKey): number {
  return key === "uniques" ? (m.uniques ?? 0) : m[key];
}

/** Click → lead conversion rate, or `null` without clicks. */
export function conversionRate(m: Pick<AnalyticsMetrics, "clicks" | "leads">): number | null {
  return m.clicks > 0 ? (m.leads / m.clicks) * 100 : null;
}
