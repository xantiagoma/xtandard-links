/**
 * Browser helper for conversion attribution (ADR 0010) — the open equivalent
 * of `@dub/analytics`'s click-id capture. Zero dependencies, ~1 KB.
 *
 * Call {@link captureClickId} once on page load of the destination site: it
 * reads the click id the redirect appended (`?xl_id=clk_…`), stores it in a
 * first-party cookie and removes it from the address bar. Later, send
 * {@link getClickId} with your signup request so the server can call
 * `core.trackLead({ clickId, customerId })`.
 *
 * ```ts
 * import { captureClickId, getClickId } from "@xtandard/links/client";
 *
 * captureClickId();
 * await fetch("/signup", { method: "POST", body: JSON.stringify({ email, clickId: getClickId() }) });
 * ```
 *
 * Import from `@xtandard/links/client`.
 *
 * @module client
 */

/** Options for {@link captureClickId}. */
export interface CaptureOptions {
  /** Query parameter carrying the click id. Default `"xl_id"`. */
  param?: string;
  /** Cookie name. Default `"xl_id"`. */
  cookie?: string;
  /** Cookie lifetime in days. Default 90. */
  days?: number;
  /** Cookie domain, e.g. `".acme.com"` to share across subdomains. Default: current host. */
  domain?: string;
  /** Remove the parameter from the address bar. Default `true`. */
  cleanUrl?: boolean;
}

const CLICK_ID_RE = /^clk_[0-9A-HJKMNP-TV-Z]{26}$/;

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  for (const part of document.cookie.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/**
 * Capture the click id from the current URL into a cookie. Returns the click
 * id in effect (newly captured or previously stored), or `undefined`.
 */
export function captureClickId(options: CaptureOptions = {}): string | undefined {
  if (typeof window === "undefined" || typeof document === "undefined") return undefined;
  const param = options.param ?? "xl_id";
  const cookie = options.cookie ?? "xl_id";
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get(param);
  if (fromUrl && CLICK_ID_RE.test(fromUrl)) {
    const maxAge = Math.round((options.days ?? 90) * 86_400);
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    const domain = options.domain ? `; Domain=${options.domain}` : "";
    document.cookie = `${cookie}=${encodeURIComponent(fromUrl)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${domain}${secure}`;
    if (options.cleanUrl ?? true) {
      url.searchParams.delete(param);
      window.history.replaceState(window.history.state, "", url.toString());
    }
    return fromUrl;
  }
  return getClickId({ cookie });
}

/** The stored click id, if any. */
export function getClickId(options: { cookie?: string } = {}): string | undefined {
  const value = readCookie(options.cookie ?? "xl_id");
  return value && CLICK_ID_RE.test(value) ? value : undefined;
}

/** Forget the stored click id (e.g. after a successful lead). */
export function clearClickId(options: { cookie?: string; domain?: string } = {}): void {
  if (typeof document === "undefined") return;
  const domain = options.domain ? `; Domain=${options.domain}` : "";
  document.cookie = `${options.cookie ?? "xl_id"}=; Path=/; Max-Age=0${domain}`;
}
