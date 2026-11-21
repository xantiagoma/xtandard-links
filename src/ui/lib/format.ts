/**
 * Pure UI formatters — no React, no DOM. Unit-tested in `test/ui-lib.test.ts`
 * (visual behavior is covered by the Playwright e2e suite instead).
 *
 * @module
 */

import type { AnalyticsDimension, AnalyticsInterval } from "../../analytics/contract.ts";

/** Absolute date-time, locale-aware. Returns `"—"` for missing/invalid input. */
export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Short date (`"Mar 4, 2026"`). */
export function formatDate(iso: string | undefined | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/**
 * Compact relative time: `"just now"`, `"5m ago"`, `"in 2h"`, `"3d ago"`, then
 * months/years. `now` is injectable for tests.
 */
export function relativeTime(iso: string | undefined | null, now: number = Date.now()): string {
  if (!iso) return "—";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "—";
  const diff = now - at;
  const abs = Math.abs(diff);
  if (abs < 10_000) return "just now";
  const units: [number, string][] = [
    [1000, "s"],
    [60_000, "m"],
    [3_600_000, "h"],
    [86_400_000, "d"],
    [30 * 86_400_000, "mo"],
    [365 * 86_400_000, "y"],
  ];
  let value = Math.round(abs / 1000);
  let unit = "s";
  for (const [ms, label] of units) {
    if (abs >= ms) {
      value = Math.floor(abs / ms);
      unit = label;
    }
  }
  return diff >= 0 ? `${value}${unit} ago` : `in ${value}${unit}`;
}

/** Grouped integer (`12,345`). */
export function formatCount(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

/** Compact number for tight spaces (`950`, `1.2K`, `34K`, `1.5M`). */
export function formatCompact(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  const [div, suffix] = abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : [1e3, "K"];
  const v = n / div;
  const digits = Math.abs(v) < 10 ? 1 : 0;
  return `${v.toFixed(digits).replace(/\.0$/, "")}${suffix}`;
}

/** Money from minor units (`12345, "USD"` → `"$123.45"`). Zero-decimal currencies are respected. */
export function formatMoney(minor: number | undefined | null, currency = "USD"): string {
  if (minor === undefined || minor === null || !Number.isFinite(minor)) return "—";
  let fmt: Intl.NumberFormat;
  try {
    fmt = new Intl.NumberFormat("en-US", { style: "currency", currency });
  } catch {
    fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  }
  const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
  return fmt.format(minor / 10 ** digits);
}

/** Percent of `part` in `total` (`"12.5%"`, `"0%"`; `"—"` when total is 0). */
export function formatPercent(part: number, total: number): string {
  if (!total) return "—";
  const pct = (part / total) * 100;
  if (pct > 0 && pct < 0.1) return "<0.1%";
  return `${pct.toFixed(pct < 10 ? 1 : 0).replace(/\.0$/, "")}%`;
}

/** Relative change between two periods (`+12%`, `−4%`); `null` when undefined. */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return current ? null : 0;
  return ((current - previous) / previous) * 100;
}

/** Truncate with an ellipsis; never longer than `max` (including the ellipsis). */
export function truncate(text: string, max: number): string {
  if (max <= 1) return text.length > max ? "…" : text;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The short URL for a link (`https://go.acme.com/spring`). */
export function shortUrl(link: { domain: string; slug: string }, protocol = "https:"): string {
  return `${protocol}//${link.domain}/${link.slug}`;
}

/** A URL without its scheme and trailing slash, for display (`acme.com/pricing`). */
export function displayUrl(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/$/, "");
}

/** Hostname of a URL, or the input when it does not parse (app schemes). */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

/** English country name for an ISO alpha-2 code (`"DE"` → `"Germany"`). */
export function countryName(code: string): string {
  if (!/^[A-Z]{2}$/i.test(code)) return code;
  try {
    return regionNames?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** Regional-indicator flag emoji for an ISO alpha-2 code; `""` when not a code. */
export function flagEmoji(code: string): string {
  if (!/^[A-Z]{2}$/i.test(code)) return "";
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

const CONTINENTS: Record<string, string> = {
  AF: "Africa",
  AN: "Antarctica",
  AS: "Asia",
  EU: "Europe",
  NA: "North America",
  OC: "Oceania",
  SA: "South America",
};

/** Continent name for a two-letter code. */
export function continentName(code: string): string {
  return CONTINENTS[code.toUpperCase()] ?? code;
}

const PRETTY: Record<string, string> = {
  ios: "iOS",
  macos: "macOS",
  android: "Android",
  windows: "Windows",
  "windows-phone": "Windows Phone",
  linux: "Linux",
  chromeos: "ChromeOS",
  tv: "TV",
  ie: "Internet Explorer",
  uc: "UC Browser",
  wechat: "WeChat",
  "(direct)": "Direct",
  "(none)": "(none)",
};

/** Title-case a lowercase family (`"chrome"` → `"Chrome"`, `"ios"` → `"iOS"`). */
export function prettyValue(value: string): string {
  if (PRETTY[value] !== undefined) return PRETTY[value];
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Human label for a breakdown value, per dimension. */
export function dimensionValueLabel(dim: AnalyticsDimension, value: string): string {
  if (value === "(none)") return dim.startsWith("utm_") ? "(not set)" : "Unknown";
  switch (dim) {
    case "country":
      return countryName(value);
    case "continent":
      return continentName(value);
    case "device":
    case "os":
    case "browser":
      return prettyValue(value);
    case "referrer":
      return value === "(direct)" ? "Direct" : value;
    case "qr":
      return value === "true" ? "QR scan" : "Link click";
    default:
      return value;
  }
}

const DIMENSION_LABELS: Record<AnalyticsDimension, string> = {
  link: "Link",
  domain: "Domain",
  country: "Country",
  continent: "Continent",
  city: "City",
  device: "Device",
  os: "OS",
  browser: "Browser",
  referrer: "Referrer",
  utm_source: "UTM source",
  utm_medium: "UTM medium",
  utm_campaign: "UTM campaign",
  qr: "Source",
  variant: "Variant",
};

/** Display name of an analytics dimension. */
export function dimensionLabel(dim: AnalyticsDimension): string {
  return DIMENSION_LABELS[dim];
}

/** Axis/tooltip label for a timeseries bucket. */
export function bucketLabel(
  iso: string,
  interval: AnalyticsInterval,
  style: "axis" | "tooltip" = "axis",
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (interval === "hour") {
    return new Intl.DateTimeFormat(
      undefined,
      style === "axis"
        ? { hour: "numeric" }
        : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
    ).format(d);
  }
  return new Intl.DateTimeFormat(
    undefined,
    style === "axis"
      ? { month: "short", day: "numeric" }
      : { weekday: "short", month: "short", day: "numeric", year: "numeric" },
  ).format(d);
}

/** Initials for an avatar (`"Ada Lovelace"` → `"AL"`, `"ada@x.io"` → `"A"`). */
export function initials(name: string | undefined | null): string {
  if (!name) return "?";
  const words = name
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}
