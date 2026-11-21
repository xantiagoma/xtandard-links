/**
 * The analytics surface shared by the tenant Analytics view, the link detail
 * and the viewer widget: range + interval controls, filter chips, KPI tiles
 * (which double as the chart's metric picker), the timeseries chart and the
 * breakdown cards. Adapts to the sink's capabilities (uniques, crossFilter,
 * intervals).
 *
 * @module
 */

import * as React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "wouter";
import {
  ArrowDownRight,
  ArrowUpRight,
  Gamepad2,
  Globe,
  Info,
  Monitor,
  QrCode,
  Smartphone,
  Tablet,
  Tv,
  X,
} from "lucide-react";
import {
  ANALYTICS_DIMENSIONS,
  type AnalyticsDimension,
  type AnalyticsInterval,
} from "../../analytics/contract.ts";
import { getAnalytics } from "../api.ts";
import type { AnalyticsResult, PublicLink } from "../types.ts";
import { errorMessage } from "../types.ts";
import {
  availableMetrics,
  canQuery,
  decodeFilters,
  defaultInterval,
  encodeFilters,
  filterEntries,
  intervalsFor,
  isRangePreset,
  metricValue,
  previousRange,
  RANGE_PRESETS,
  rangeFor,
  toggleFilter,
  type Filters,
  type MetricKey,
  type RangePreset,
} from "../lib/analytics.ts";
import {
  dimensionLabel,
  dimensionValueLabel,
  flagEmoji,
  formatCompact,
  formatCount,
  formatMoney,
  formatPercent,
  percentChange,
} from "../lib/format.ts";
import { cn } from "../lib/utils.ts";
import { useShell } from "../lib/shell.tsx";
import { BarList, Sparkline, TimeseriesChart, type BarRow } from "./Charts.tsx";
import { Segmented } from "./primitives.tsx";

/* ─── URL-backed state ──────────────────────────────────────────────────────── */

export interface AnalyticsState {
  preset: RangePreset;
  interval: AnalyticsInterval;
  metric: MetricKey;
  filters: Filters;
}

/** Range, interval, metric and filters live in the query string (shareable views). */
function useAnalyticsState(): [AnalyticsState, (patch: Partial<AnalyticsState>) => void] {
  const { config } = useShell();
  const caps = config.capabilities;
  const [params, setParams] = useSearchParams();
  const presetParam = params.get("range");
  const preset: RangePreset = isRangePreset(presetParam) ? presetParam : "30d";
  const allowed = intervalsFor(preset, caps);
  const intervalParam = params.get("interval") as AnalyticsInterval | null;
  const interval =
    intervalParam && allowed.includes(intervalParam)
      ? intervalParam
      : defaultInterval(preset, caps);
  const metrics = availableMetrics(caps);
  const metricParam = params.get("metric") as MetricKey | null;
  const metric = metricParam && metrics.includes(metricParam) ? metricParam : "clicks";
  const filters = decodeFilters(params.get("filters"), ANALYTICS_DIMENSIONS);

  const update = (patch: Partial<AnalyticsState>) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const set = (k: string, v: string | undefined, dflt?: string) => {
          if (!v || v === dflt) next.delete(k);
          else next.set(k, v);
        };
        if (patch.preset !== undefined) {
          set("range", patch.preset, "30d");
          next.delete("interval");
        }
        if (patch.interval !== undefined) set("interval", patch.interval);
        if (patch.metric !== undefined) set("metric", patch.metric, "clicks");
        if (patch.filters !== undefined) set("filters", encodeFilters(patch.filters));
        return next;
      },
      { replace: true },
    );
  };

  return [{ preset, interval, metric, filters }, update];
}

/* ─── Metric presentation ───────────────────────────────────────────────────── */

const METRIC_META: Record<MetricKey, { label: string; color: string }> = {
  clicks: { label: "Clicks", color: "var(--chart-1)" },
  uniques: { label: "Visitors", color: "var(--chart-2)" },
  leads: { label: "Leads", color: "var(--chart-5)" },
  sales: { label: "Sales", color: "var(--chart-3)" },
  saleAmount: { label: "Revenue", color: "var(--chart-3)" },
};

const formatMetric = (key: MetricKey, v: number) =>
  key === "saleAmount" ? formatMoney(v, "USD") : formatCount(v);

const formatMetricShort = (key: MetricKey, v: number) =>
  key === "saleAmount" ? `$${formatCompact(v / 100)}` : formatCompact(v);

function Delta({ current, previous }: { current: number; previous: number | undefined }) {
  if (previous === undefined) return null;
  const change = percentChange(current, previous);
  if (change === null) {
    return <span className="text-[11px] font-medium text-muted-foreground">new</span>;
  }
  const rounded = Math.round(change);
  if (rounded === 0)
    return <span className="text-[11px] font-medium text-muted-foreground">±0%</span>;
  const up = rounded > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums",
        up ? "text-success" : "text-destructive",
      )}
      title="Compared with the previous period"
    >
      <Icon className="size-3" />
      {Math.abs(rounded)}%
    </span>
  );
}

function KpiTile({
  metric,
  value,
  previous,
  series,
  selected,
  onSelect,
  unavailable,
}: {
  metric: MetricKey;
  /** `undefined` while loading. */
  value: number | undefined;
  previous: number | undefined;
  series: number[];
  selected: boolean;
  onSelect: () => void;
  /** Why the metric cannot be shown for the current filters. */
  unavailable?: string;
}) {
  const meta = METRIC_META[metric];
  if (unavailable) {
    return (
      <div
        className="flex min-w-0 flex-col gap-1 rounded-xl border border-dashed border-border bg-card px-4 pb-2 pt-3.5"
        title={unavailable}
      >
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="size-1.5 rounded-full" style={{ background: meta.color }} />
          {meta.label}
        </span>
        <span
          className="text-2xl font-semibold tracking-tight text-muted-foreground"
          data-testid={`kpi-${metric}`}
        >
          —
        </span>
        <span className="text-[11px] leading-tight text-muted-foreground">{unavailable}</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group relative flex min-w-0 flex-col gap-1 rounded-xl border bg-card px-4 pb-2 pt-3.5 text-left outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-accent/60 shadow-[0_0_0_1px_var(--accent)]"
          : "border-border hover:border-foreground/20",
      )}
    >
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="size-1.5 rounded-full" style={{ background: meta.color }} />
        {meta.label}
      </span>
      <span className="flex items-baseline gap-2">
        <span
          className="text-2xl font-semibold tabular-nums tracking-tight"
          data-testid={`kpi-${metric}`}
        >
          {value === undefined ? (
            <span className="inline-block h-7 w-20 animate-pulse rounded-md bg-secondary align-middle" />
          ) : (
            formatMetric(metric, value)
          )}
        </span>
        {value !== undefined && <Delta current={value} previous={previous} />}
      </span>
      <Sparkline values={series} color={meta.color} height={26} className="mt-0.5 opacity-80" />
    </button>
  );
}

/* ─── Breakdown cards ───────────────────────────────────────────────────────── */

const DEVICE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  mobile: Smartphone,
  tablet: Tablet,
  desktop: Monitor,
  tv: Tv,
  console: Gamepad2,
};

function rowIcon(dim: AnalyticsDimension, key: string): React.ReactNode {
  if (dim === "country") {
    const flag = flagEmoji(key);
    return flag ? (
      <span className="w-4 text-center text-[13px] leading-none">{flag}</span>
    ) : (
      <Globe className="size-3.5 text-muted-foreground" />
    );
  }
  if (dim === "device") {
    const Icon = DEVICE_ICONS[key] ?? Globe;
    return <Icon className="size-3.5 text-muted-foreground" />;
  }
  if (dim === "qr") {
    return key === "true" ? (
      <QrCode className="size-3.5 text-muted-foreground" />
    ) : (
      <Globe className="size-3.5 text-muted-foreground" />
    );
  }
  if (dim === "referrer") {
    return (
      <span className="flex size-4 items-center justify-center rounded-[4px] bg-secondary text-[9px] font-semibold uppercase text-muted-foreground">
        {key === "(direct)" ? "→" : key.replace(/^www\./, "").charAt(0)}
      </span>
    );
  }
  return null;
}

export interface BreakdownTab {
  dim: AnalyticsDimension;
  label: string;
}

function BreakdownCard({
  title,
  tabs,
  tenant,
  range,
  linkIds,
  filters,
  metric,
  linkLabel,
  onFilter,
  className,
}: {
  title: string;
  tabs: BreakdownTab[];
  tenant: string;
  range: { from: string; to: string };
  linkIds?: string[];
  filters: Filters;
  metric: MetricKey;
  linkLabel?: (id: string) => { label: string; sub?: string };
  onFilter: (dim: AnalyticsDimension, value: string) => void;
  className?: string;
}) {
  const { config } = useShell();
  const [dim, setDim] = React.useState<AnalyticsDimension>(tabs[0]!.dim);
  const answerable = canQuery(config.capabilities, { groupBy: dim, filters, linkIds });
  const query = useQuery({
    queryKey: ["analytics", tenant, "breakdown", dim, range, linkIds, filters],
    queryFn: () =>
      getAnalytics(tenant, {
        ...range,
        interval: "none",
        groupBy: dim,
        linkIds,
        filters,
        limit: 10,
      }),
    enabled: !!tenant && answerable,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const rows: BarRow[] = (query.data?.breakdown ?? [])
    .map((row) => {
      const value = metricValue(row, metric);
      if (dim === "link") {
        const info = linkLabel?.(row.key) ?? { label: row.key };
        return {
          key: row.key,
          text: info.label,
          label: (
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate font-medium">{info.label}</span>
              {info.sub ? (
                <span className="truncate text-[11.5px] text-muted-foreground">{info.sub}</span>
              ) : null}
            </span>
          ),
          value,
        };
      }
      const text = dimensionValueLabel(dim, row.key);
      return { key: row.key, text, label: text, icon: rowIcon(dim, row.key), value };
    })
    .filter((r) => metric === "clicks" || r.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = metricValue(
    query.data?.totals ?? { clicks: 0, botClicks: 0, leads: 0, sales: 0, saleAmount: 0 },
    metric,
  );

  return (
    <section
      className={cn("flex min-w-0 flex-col rounded-xl border border-border bg-card", className)}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
        {tabs.length > 1 && (
          <Segmented
            size="sm"
            value={dim}
            onValueChange={(v) => setDim(v)}
            options={tabs.map((t) => ({ value: t.dim, label: t.label }))}
          />
        )}
      </div>
      <div className="flex-1 px-2 py-2">
        {!answerable ? (
          <p className="flex items-start gap-2 px-2 py-6 text-[12.5px] text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            This analytics sink filters on one dimension at a time — clear the filter to break down
            by {dimensionLabel(dim).toLowerCase()}.
          </p>
        ) : query.isError ? (
          <p className="px-2 py-6 text-center text-[12.5px] text-destructive">
            {errorMessage(query.error, "Failed to load")}
          </p>
        ) : query.isLoading ? (
          <div className="flex flex-col gap-1 py-1" aria-busy>
            {Array.from({ length: 5 }, (_, i) => (
              <div
                key={i}
                className="h-8 animate-pulse rounded-md bg-secondary/60"
                style={{ width: `${90 - i * 14}%` }}
              />
            ))}
          </div>
        ) : (
          <BarList
            rows={rows}
            activeKeys={filters[dim]}
            onSelect={(key) => onFilter(dim, key)}
            formatValue={(v) => formatMetricShort(metric, v)}
            emptyLabel={`No ${METRIC_META[metric].label.toLowerCase()} in this period.`}
          />
        )}
      </div>
      {answerable && rows.length > 0 && metric !== "saleAmount" && (
        <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          Top {rows.length} ·{" "}
          {formatPercent(
            rows.reduce((s, r) => s + r.value, 0),
            total,
          )}{" "}
          of {METRIC_META[metric].label.toLowerCase()}
        </div>
      )}
    </section>
  );
}

/* ─── Panel ─────────────────────────────────────────────────────────────────── */

export function AnalyticsPanel({
  tenant,
  linkIds,
  links,
  showLinkBreakdown = true,
  extraCards,
  headerActions,
}: {
  tenant: string;
  /** Scope every query to these links (the link detail page). */
  linkIds?: string[];
  /** Known links, for labelling the top-links breakdown. */
  links?: PublicLink[];
  showLinkBreakdown?: boolean;
  /** Extra breakdown tabs (e.g. variants on an A/B link). */
  extraCards?: { title: string; tabs: BreakdownTab[] }[];
  headerActions?: React.ReactNode;
}) {
  const { config } = useShell();
  const caps = config.capabilities;
  const [state, update] = useAnalyticsState();
  const { preset, interval, metric, filters } = state;
  const range = React.useMemo(() => rangeFor(preset, interval), [preset, interval]);
  const prev = React.useMemo(() => previousRange(range), [range]);
  const intervals = intervalsFor(preset, caps);

  const main = useQuery({
    queryKey: ["analytics", tenant, "series", range, interval, linkIds, filters],
    queryFn: () => getAnalytics(tenant, { ...range, interval, linkIds, filters }),
    enabled: !!tenant,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const previous = useQuery({
    queryKey: ["analytics", tenant, "totals", prev, linkIds, filters],
    queryFn: () => getAnalytics(tenant, { ...prev, interval: "none", linkIds, filters }),
    enabled: !!tenant,
    staleTime: 60_000,
  });

  const linkMap = React.useMemo(() => new Map((links ?? []).map((l) => [l.id, l])), [links]);
  const linkLabel = (id: string) => {
    const l = linkMap.get(id);
    return l ? { label: `${l.domain}/${l.slug}`, sub: l.title ?? undefined } : { label: id };
  };

  const onFilter = (dim: AnalyticsDimension, value: string) =>
    update({ filters: toggleFilter(filters, dim, value, caps) });

  const metrics = availableMetrics(caps);
  const series = (key: MetricKey) => (main.data?.timeseries ?? []).map((b) => metricValue(b, key));
  const chartPoints = (main.data?.timeseries ?? []).map((b) => ({
    at: b.at,
    value: metricValue(b, metric),
  }));
  const active = filterEntries(filters);
  // Leads and sales carry only link + domain, so visitor-dimension filters zero them out.

  const cards: { title: string; tabs: BreakdownTab[] }[] = [
    ...(showLinkBreakdown
      ? [{ title: "Top links", tabs: [{ dim: "link" as const, label: "Links" }] }]
      : []),
    {
      title: "Referrers",
      tabs: [
        { dim: "referrer", label: "Referrers" },
        { dim: "qr", label: "QR" },
        { dim: "domain", label: "Domains" },
      ],
    },
    {
      title: "Locations",
      tabs: [
        { dim: "country", label: "Countries" },
        { dim: "city", label: "Cities" },
        { dim: "continent", label: "Continents" },
      ],
    },
    {
      title: "Devices",
      tabs: [
        { dim: "device", label: "Devices" },
        { dim: "os", label: "OS" },
        { dim: "browser", label: "Browsers" },
      ],
    },
    {
      title: "UTM",
      tabs: [
        { dim: "utm_source", label: "Source" },
        { dim: "utm_medium", label: "Medium" },
        { dim: "utm_campaign", label: "Campaign" },
      ],
    },
    ...(extraCards ?? []),
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={preset}
          onValueChange={(v) => update({ preset: v })}
          options={RANGE_PRESETS.map((p) => ({
            value: p.value,
            label: p.label,
            "aria-label": p.long,
          }))}
        />
        {intervals.length > 1 && (
          <Segmented
            value={interval}
            onValueChange={(v) => update({ interval: v })}
            options={intervals.map((i) => ({ value: i, label: i === "hour" ? "Hourly" : "Daily" }))}
          />
        )}
        {active.map(([dim, values]) => (
          <span
            key={dim}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 pl-2.5 pr-1 text-[12.5px]"
          >
            <span className="text-muted-foreground">{dimensionLabel(dim)}</span>
            <span className="font-medium text-foreground">
              {dim === "link"
                ? values.map((v) => linkLabel(v).label).join(", ")
                : values.map((v) => dimensionValueLabel(dim, v)).join(", ")}
            </span>
            <button
              type="button"
              aria-label={`Clear ${dimensionLabel(dim)} filter`}
              onClick={() => {
                const next = { ...filters };
                delete next[dim];
                update({ filters: next });
              }}
              className="rounded p-0.5 text-muted-foreground hover:bg-accent/20 hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        {active.length > 1 && (
          <button
            type="button"
            onClick={() => update({ filters: {} })}
            className="text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Clear all
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">{headerActions}</div>
      </div>

      {main.isError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
          {errorMessage(main.error, "Failed to load analytics")}
        </p>
      )}

      {/* KPI tiles */}
      <div
        className={cn(
          "grid grid-cols-2 gap-3",
          metrics.length === 5 ? "md:grid-cols-5" : "md:grid-cols-4",
        )}
      >
        {metrics.map((key) => (
          <KpiTile
            key={key}
            metric={key}
            value={main.data ? metricValue(main.data.totals, key) : undefined}
            previous={previous.data ? metricValue(previous.data.totals, key) : undefined}
            series={series(key)}
            selected={metric === key}
            onSelect={() => update({ metric: key })}
          />
        ))}
      </div>

      {/* Timeseries */}
      <section className="rounded-xl border border-border bg-card px-4 pb-3 pt-4">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-semibold">
            {METRIC_META[metric].label}{" "}
            <span className="font-normal text-muted-foreground">
              · {RANGE_PRESETS.find((p) => p.value === preset)?.long.toLowerCase()}
            </span>
          </h2>
          {main.data && <BotNote result={main.data} />}
        </div>
        {main.isLoading ? (
          <div className="h-[260px] animate-pulse rounded-lg bg-secondary/40" />
        ) : (
          <TimeseriesChart
            points={chartPoints}
            interval={interval}
            label={METRIC_META[metric].label}
            color={METRIC_META[metric].color}
            formatValue={(v) => formatMetricShort(metric, v)}
            loading={main.isFetching && main.isPlaceholderData}
          />
        )}
      </section>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {cards.map((card, i) => (
          <BreakdownCard
            key={card.title}
            // An odd card count lets the first card span the row.
            className={i === 0 && cards.length % 2 === 1 ? "lg:col-span-2" : undefined}
            title={card.title}
            tabs={card.tabs}
            tenant={tenant}
            range={range}
            linkIds={linkIds}
            filters={filters}
            metric={metric}
            linkLabel={linkLabel}
            onFilter={onFilter}
          />
        ))}
      </div>
    </div>
  );
}

function BotNote({ result }: { result: AnalyticsResult }) {
  if (!result.totals.botClicks) return null;
  return (
    <span
      className="text-[11.5px] text-muted-foreground"
      title="Bot clicks are recorded but never counted as clicks"
    >
      {formatCount(result.totals.botClicks)} bot click{result.totals.botClicks === 1 ? "" : "s"}{" "}
      excluded
    </span>
  );
}
