/**
 * QR codes for short links: {@link renderQrSvg} renders any text as a crisp,
 * scalable SVG (one `<path>`, `shape-rendering="crispEdges"`), and
 * {@link qrUrl} builds the URL a link's QR code should encode — its short URL
 * with `?qr=1`, so scans are counted as `qr: true` clicks and the `qr` rule
 * condition can route them.
 *
 * Encoding is done by the tiny, zero-dependency `uqr` package; works in every
 * runtime (browser, edge, Node, Bun).
 *
 * Import from `@xtandard/links/qr`.
 *
 * @module qr
 */

import { encode } from "uqr";
import type { Link } from "./schema.ts";

/** Error-correction level: recovers ~7% (L), 15% (M), 25% (Q) or 30% (H) damage. */
export type QrEcc = "L" | "M" | "Q" | "H";

/** Options for {@link renderQrSvg}. */
export interface QrSvgOptions {
  /** Width and height of the SVG in pixels. Default 256. */
  size?: number;
  /** Quiet zone around the code, in modules. Default 2. */
  margin?: number;
  /** Module (dark) colour. Default `"#000000"`. */
  foreground?: string;
  /** Background colour; `"transparent"` omits the background. Default `"#ffffff"`. */
  background?: string;
  /** Error-correction level. Default `"M"`. */
  ecc?: QrEcc;
}

const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20}|(rgb|hsl)a?\([\d\s.,%]+\))$/;

/** A CSS colour safe to embed in an SVG attribute (hex, a name, or rgb()/hsl()); else `fallback`. */
function safeColor(value: string | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  const v = value.trim();
  if (/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v)) return `#${v}`;
  return COLOR_RE.test(v) ? v : fallback;
}

const clampInt = (value: number | undefined, fallback: number, min: number, max: number) => {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value), min), max);
};

/**
 * Render `text` as a QR code SVG string.
 *
 * @example
 * ```ts
 * import { renderQrSvg } from "@xtandard/links/qr";
 *
 * const svg = renderQrSvg("https://go.acme.com/launch?qr=1", { size: 512, foreground: "#0d9488" });
 * ```
 */
export function renderQrSvg(text: string, options: QrSvgOptions = {}): string {
  const size = clampInt(options.size, 256, 16, 4096);
  const margin = clampInt(options.margin, 2, 0, 16);
  const fg = safeColor(options.foreground, "#000000");
  const bg = safeColor(options.background, "#ffffff");
  const qr = encode(text, { ecc: options.ecc ?? "M", border: 0 });
  const dim = qr.size + margin * 2;
  let d = "";
  for (let y = 0; y < qr.size; y++) {
    const row = qr.data[y] as boolean[];
    let x = 0;
    while (x < qr.size) {
      if (!row[x]) {
        x++;
        continue;
      }
      // Merge horizontal runs of dark modules into one rectangle.
      let run = 1;
      while (x + run < qr.size && row[x + run]) run++;
      d += `M${x + margin} ${y + margin}h${run}v1h-${run}z`;
      x += run;
    }
  }
  const background =
    bg === "transparent" ? "" : `<rect width="${dim}" height="${dim}" fill="${bg}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">` +
    `${background}<path fill="${fg}" d="${d}"/></svg>`
  );
}

/** Options for {@link shortUrl} and {@link qrUrl}. */
export interface ShortUrlOptions {
  /**
   * URL scheme. Default `"https:"`, except `"http:"` for `localhost`, `*.localhost`
   * and IP-literal hosts.
   */
  protocol?: "http:" | "https:";
  /** Path prefix links are served under (the redirect handler's `basePath`, e.g. `"/l"`). */
  basePath?: string;
}

const isLocalHost = (host: string) =>
  host === "localhost" ||
  host.endsWith(".localhost") ||
  /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
  host.startsWith("[");

/** The public short URL of a link (`https://go.acme.com/launch`). */
export function shortUrl(
  link: Pick<Link, "domain" | "slug">,
  options: ShortUrlOptions = {},
): string {
  const host = link.domain.replace(/:\d+$/, "");
  const protocol = options.protocol ?? (isLocalHost(host) ? "http:" : "https:");
  const base = options.basePath ? `/${options.basePath.replace(/^\/+|\/+$/g, "")}` : "";
  const path = link.slug
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  return `${protocol}//${link.domain}${base}/${path}`;
}

/** The URL a link's QR code encodes: its short URL with `?qr=1` (counted as a QR scan). */
export function qrUrl(link: Pick<Link, "domain" | "slug">, options: ShortUrlOptions = {}): string {
  return `${shortUrl(link, options)}?qr=1`;
}
