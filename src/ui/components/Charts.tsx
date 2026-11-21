/**
 * Hand-rolled SVG charts (ADR 0003 — no chart library in the bundle): a
 * responsive timeseries area chart with hover, a sparkline, and a breakdown
 * bar list. Colors come from the theme tokens so both themes just work.
 *
 * @module
 */

import * as React from "react";
import type { AnalyticsInterval } from "../../analytics/contract.ts";
import {
  areaPath,
  barPercents,
  labelIndices,
  nearestIndex,
  niceScale,
  projectPoints,
  smoothPath,
  type PlotBox,
} from "../lib/chart.ts";
import { bucketLabel, formatCompact } from "../lib/format.ts";
import { cn } from "@xtandard/kit/ui";

/** Track an element's content width (ResizeObserver), with a fallback for first paint. */
function useWidth<T extends HTMLElement>(fallback: number): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T>(null);
  const [width, setWidth] = React.useState(fallback);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || fallback);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, width];
}

const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "");

/* ─── TimeseriesChart ───────────────────────────────────────────────────────── */

export interface SeriesPoint {
  at: string;
  value: number;
}

export function TimeseriesChart({
  points,
  interval,
  label,
  color = "var(--chart-1)",
  height = 260,
  formatValue = (v: number) => formatCompact(v),
  loading,
}: {
  points: SeriesPoint[];
  interval: AnalyticsInterval;
  label: string;
  color?: string;
  height?: number;
  formatValue?: (v: number) => string;
  loading?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(640);
  const [hover, setHover] = React.useState<number | null>(null);
  const gradientId = safeId(`ts-${React.useId()}`);

  const values = points.map((p) => p.value);
  const scale = niceScale(Math.max(0, ...values), 4);
  const yLabelWidth = Math.max(28, formatValue(scale.max).length * 7 + 10);
  const box: PlotBox = {
    left: yLabelWidth,
    top: 12,
    width: Math.max(10, width - yLabelWidth - 8),
    height: height - 12 - 28,
  };
  const pts = projectPoints(values, scale.max, box);
  const baseline = box.top + box.height;
  const xLabels = labelIndices(points.length, Math.max(2, Math.floor(box.width / 78)));
  const active = hover !== null ? points[hover] : undefined;
  const activePt = hover !== null ? pts[hover] : undefined;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover(nearestIndex(points.length, e.clientX - rect.left, box));
  };

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${label} over time`}
        className={cn("block overflow-visible", loading && "opacity-50")}
        onPointerMove={points.length ? onMove : undefined}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {/* Grid + y labels */}
        {scale.ticks.map((t) => {
          const y = baseline - (t / scale.max) * box.height;
          return (
            <g key={t}>
              <line
                x1={box.left}
                x2={box.left + box.width}
                y1={y}
                y2={y}
                stroke="var(--border)"
                strokeDasharray={t === 0 ? undefined : "3 4"}
              />
              <text
                x={box.left - 8}
                y={y}
                dy="0.32em"
                textAnchor="end"
                className="fill-muted-foreground text-[10.5px] tabular-nums"
              >
                {formatValue(t)}
              </text>
            </g>
          );
        })}
        {/* X labels */}
        {xLabels.map((i) => {
          const p = pts[i];
          const point = points[i];
          if (!p || !point) return null;
          const anchor =
            points.length > 1 && i === 0 ? "start" : i === points.length - 1 ? "end" : "middle";
          return (
            <text
              key={i}
              x={p.x}
              y={baseline + 18}
              textAnchor={anchor}
              className="fill-muted-foreground text-[10.5px]"
            >
              {bucketLabel(point.at, interval)}
            </text>
          );
        })}
        {pts.length > 0 && (
          <>
            <path d={areaPath(pts, baseline)} fill={`url(#${gradientId})`} />
            <path
              d={smoothPath(pts)}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </>
        )}
        {activePt && (
          <g pointerEvents="none">
            <line
              x1={activePt.x}
              x2={activePt.x}
              y1={box.top}
              y2={baseline}
              stroke="var(--muted-foreground)"
              strokeOpacity={0.4}
            />
            <circle
              cx={activePt.x}
              cy={activePt.y}
              r={4.5}
              fill="var(--card)"
              stroke={color}
              strokeWidth={2}
            />
          </g>
        )}
      </svg>
      {active && activePt && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg"
          style={{
            left: Math.min(Math.max(activePt.x - 70, 0), Math.max(0, width - 150)),
            transform: `translateY(${Math.max(0, activePt.y - 70)}px)`,
          }}
        >
          <p className="text-[11px] text-muted-foreground">
            {bucketLabel(active.at, interval, "tooltip")}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] font-semibold tabular-nums">
            <span className="size-2 rounded-full" style={{ background: color }} />
            {formatValue(active.value)}{" "}
            <span className="font-normal text-muted-foreground">{label.toLowerCase()}</span>
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Sparkline ─────────────────────────────────────────────────────────────── */

export function Sparkline({
  values,
  color = "var(--chart-1)",
  height = 28,
  className,
}: {
  values: number[];
  color?: string;
  height?: number;
  className?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(96);
  const gradientId = safeId(`sp-${React.useId()}`);
  const box: PlotBox = { left: 1, top: 2, width: Math.max(4, width - 2), height: height - 4 };
  const pts = projectPoints(values, Math.max(1, ...values), box);
  return (
    <div ref={ref} className={cn("w-full", className)} style={{ height }} aria-hidden>
      {values.length > 1 && (
        <svg width={width} height={height} className="block overflow-visible">
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath(pts, box.top + box.height)} fill={`url(#${gradientId})`} />
          <path d={smoothPath(pts)} fill="none" stroke={color} strokeWidth={1.5} />
        </svg>
      )}
    </div>
  );
}

/* ─── BarList ───────────────────────────────────────────────────────────────── */

export interface BarRow {
  key: string;
  label: React.ReactNode;
  /** Plain-text label for titles / aria. */
  text: string;
  icon?: React.ReactNode;
  value: number;
  /** Secondary figure shown muted (e.g. leads, revenue). */
  extra?: React.ReactNode;
}

/**
 * A breakdown as horizontal bars behind the labels (Plausible/Dub style). Rows
 * are buttons when `onSelect` is set (click to filter).
 */
export function BarList({
  rows,
  onSelect,
  activeKeys,
  formatValue = (v: number) => formatCompact(v),
  emptyLabel = "No data for this period.",
}: {
  rows: BarRow[];
  onSelect?: (key: string) => void;
  activeKeys?: string[];
  formatValue?: (v: number) => string;
  emptyLabel?: string;
}) {
  const pct = barPercents(rows.map((r) => r.value));
  if (rows.length === 0) {
    return <p className="py-8 text-center text-[13px] text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((row, i) => {
        const active = activeKeys?.includes(row.key);
        const content = (
          <>
            <span
              aria-hidden
              className={cn(
                "absolute inset-y-0 left-0 rounded-md transition-[width] duration-300",
                active ? "bg-accent/30" : "bg-accent/12 group-hover:bg-accent/20",
              )}
              style={{ width: `${Math.max(pct[i] ?? 0, 0.6)}%` }}
            />
            <span className="relative flex min-w-0 flex-1 items-center gap-2">
              {row.icon}
              <span className="truncate">{row.label}</span>
            </span>
            {row.extra ? (
              <span className="relative shrink-0 text-[11.5px] text-muted-foreground tabular-nums">
                {row.extra}
              </span>
            ) : null}
            <span className="relative w-12 shrink-0 text-right font-medium tabular-nums">
              {formatValue(row.value)}
            </span>
          </>
        );
        const cls = cn(
          "group relative flex h-8 w-full items-center gap-3 overflow-hidden rounded-md px-2.5 text-left text-[13px] outline-none",
          onSelect && "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring",
        );
        return (
          <li key={row.key}>
            {onSelect ? (
              <button
                type="button"
                title={active ? `Remove filter: ${row.text}` : `Filter by ${row.text}`}
                aria-label={`${active ? "Remove filter:" : "Filter by"} ${row.text} (${formatValue(row.value)})`}
                aria-pressed={active}
                onClick={() => onSelect(row.key)}
                className={cls}
              >
                {content}
              </button>
            ) : (
              <div className={cls} title={row.text}>
                {content}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
