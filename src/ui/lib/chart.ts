/**
 * Chart math for the hand-rolled SVG charts (ADR 0003: no chart library):
 * nice axis scales, point projection, line/area paths and label thinning.
 * Pure — unit-tested in `test/ui-lib.test.ts`.
 *
 * @module
 */

/** A "nice" y-axis: rounded max and evenly spaced ticks from 0. */
export interface NiceScale {
  max: number;
  step: number;
  ticks: number[];
}

/**
 * Round `maxValue` up to a 1/2/2.5/5 × 10ⁿ step so axis labels read cleanly.
 * Always at least one step above 0 (an all-zero series still gets an axis).
 */
export function niceScale(maxValue: number, tickCount = 4): NiceScale {
  const target = Math.max(1, tickCount);
  const raw = Math.max(maxValue, 0) / target;
  if (raw <= 0 || !Number.isFinite(raw)) {
    return { max: target, step: 1, ticks: Array.from({ length: target + 1 }, (_, i) => i) };
  }
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const residual = raw / magnitude;
  const factor =
    residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10;
  // Integer counts never get fractional steps.
  const step = Math.max(1, factor * magnitude);
  const count = Math.max(1, Math.ceil(maxValue / step));
  const ticks = Array.from({ length: count + 1 }, (_, i) => i * step);
  return { max: count * step, step, ticks };
}

/** Plot area inside the SVG (padding for axes). */
export interface PlotBox {
  width: number;
  height: number;
  left: number;
  top: number;
}

/** Project a series onto the plot box: x evenly spaced, y scaled to `max` (0 at the bottom). */
export function projectPoints(
  values: readonly number[],
  max: number,
  box: PlotBox,
): { x: number; y: number }[] {
  const n = values.length;
  const safeMax = max > 0 ? max : 1;
  return values.map((v, i) => ({
    x: box.left + (n <= 1 ? box.width / 2 : (i / (n - 1)) * box.width),
    y: box.top + box.height - (Math.max(0, v) / safeMax) * box.height,
  }));
}

const r = (n: number) => Math.round(n * 100) / 100;

/** SVG path through the points (straight segments). `""` for no points. */
export function linePath(points: readonly { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${r(p.x)},${r(p.y)}`).join("");
}

/**
 * Smooth SVG path (monotone-ish cubic: control points at one third of the
 * horizontal gap, y held flat) — never overshoots below the baseline.
 */
export function smoothPath(points: readonly { x: number; y: number }[]): string {
  if (points.length < 3) return linePath(points);
  let d = `M${r(points[0]!.x)},${r(points[0]!.y)}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dx = (b.x - a.x) / 3;
    d += `C${r(a.x + dx)},${r(a.y)} ${r(b.x - dx)},${r(b.y)} ${r(b.x)},${r(b.y)}`;
  }
  return d;
}

/** Close a line path down to the baseline for an area fill. */
export function areaPath(
  points: readonly { x: number; y: number }[],
  baseline: number,
  smooth = true,
): string {
  if (points.length === 0) return "";
  const line = smooth ? smoothPath(points) : linePath(points);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return `${line}L${r(last.x)},${r(baseline)}L${r(first.x)},${r(baseline)}Z`;
}

/** Index of the point nearest to `x` (for hover). */
export function nearestIndex(count: number, x: number, box: PlotBox): number {
  if (count <= 1) return 0;
  const t = (x - box.left) / box.width;
  return Math.min(count - 1, Math.max(0, Math.round(t * (count - 1))));
}

/**
 * Which x-axis labels to show so at most `maxLabels` fit: every `step`-th
 * index, always including the last one.
 */
export function labelIndices(count: number, maxLabels: number): number[] {
  if (count <= 0) return [];
  if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i);
  const step = Math.ceil(count / Math.max(1, maxLabels));
  const out: number[] = [];
  for (let i = 0; i < count; i += step) out.push(i);
  // Make room for the final label rather than crowding it against the previous one.
  const last = count - 1;
  if (out[out.length - 1] !== last) {
    if (last - out[out.length - 1]! < step / 2) out.pop();
    out.push(last);
  }
  return out;
}

/** Bar widths for a breakdown list: each value as a percent of the largest (min 0). */
export function barPercents(values: readonly number[]): number[] {
  const max = Math.max(0, ...values);
  return values.map((v) => (max > 0 ? (Math.max(0, v) / max) * 100 : 0));
}

/** Sum a series. */
export function sum(values: readonly number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}
