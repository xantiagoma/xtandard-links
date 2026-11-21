/**
 * Destination building: UTM merge, query pass-through and the conversion
 * click-id parameter. Pure; used by the redirect handler.
 *
 * @module
 */

import type { Utm } from "./schema.ts";

/** Query parameters the redirect consumes and never forwards. */
export const INTERNAL_QUERY_PARAMS = ["qr", "pw"] as const;

/** Options for {@link buildDestination}. */
export interface BuildDestinationInput {
  /** Base destination URL. */
  url: string;
  utm?: Utm;
  /** Query of the short URL to forward (internal params are skipped). */
  passQuery?: URLSearchParams;
  /** Append `{clickIdParam}={clickId}`. */
  clickId?: string;
  clickIdParam?: string;
}

/**
 * Merge UTM parameters (never overriding ones already on the destination),
 * forward the short URL's query (destination params win), and append the
 * click id. Non-http(s) URLs (app schemes) get the same treatment when they
 * parse as URLs; anything unparseable is returned untouched.
 */
export function buildDestination(input: BuildDestinationInput): string {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return input.url;
  }
  const params = url.searchParams;
  if (input.utm) {
    for (const [k, v] of Object.entries(input.utm)) {
      if (v && !params.has(`utm_${k}`)) params.set(`utm_${k}`, v);
    }
  }
  if (input.passQuery) {
    for (const [k, v] of input.passQuery) {
      if ((INTERNAL_QUERY_PARAMS as readonly string[]).includes(k)) continue;
      if (input.clickIdParam && k === input.clickIdParam) continue;
      if (!params.has(k)) params.append(k, v);
    }
  }
  if (input.clickId) params.set(input.clickIdParam ?? "xl_id", input.clickId);
  return url.toString();
}

/** Extract UTM values from a query string. */
export function utmFromQuery(query: URLSearchParams): Utm | undefined {
  const utm: Utm = {};
  for (const k of ["source", "medium", "campaign", "term", "content"] as const) {
    const v = query.get(`utm_${k}`);
    if (v) utm[k] = v;
  }
  return Object.keys(utm).length ? utm : undefined;
}

/** Merge two UTM sets; `primary` wins. */
export function mergeUtm(primary: Utm | undefined, secondary: Utm | undefined): Utm | undefined {
  if (!primary) return secondary;
  if (!secondary) return primary;
  return { ...secondary, ...primary };
}

/** Lowercase referrer host, or `"(direct)"`. */
export function referrerHost(referrer: string | null | undefined): string {
  if (!referrer) return "(direct)";
  try {
    return new URL(referrer).hostname.toLowerCase() || "(direct)";
  } catch {
    return "(direct)";
  }
}
