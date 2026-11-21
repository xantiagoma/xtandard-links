/**
 * Geo resolution port (ADR 0007). Built-ins read the headers edge platforms
 * already attach to every request — no IP database needed. For self-hosted
 * setups, wrap any lookup (e.g. MaxMind via the `maxmind` package) in a
 * {@link GeoResolver} function.
 *
 * @module
 */

import type { GeoInfo } from "../schema.ts";

/** Resolve geo information for a request. May be async; must not throw (errors are caught). */
export type GeoResolver = (request: Request, ip: string | undefined) => GeoInfo | Promise<GeoInfo>;

const COUNTRY_TO_CONTINENT: Record<string, string> = {};
// Compact continent table: continent code → space-separated ISO alpha-2 codes.
const CONTINENTS: Record<string, string> = {
  AF: "AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW",
  AN: "AQ BV GS HM TF",
  AS: "AE AF AM AZ BD BH BN BT CC CN CX GE HK ID IL IN IO IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE",
  EU: "AD AL AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK",
  NA: "AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI",
  OC: "AS AU CK FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV UM VU WF WS",
  SA: "AR BO BR CL CO EC FK GF GY PE PY SR UY VE",
};
for (const [continent, list] of Object.entries(CONTINENTS)) {
  for (const cc of list.split(" ")) COUNTRY_TO_CONTINENT[cc] = continent;
}

/** Continent code for an ISO alpha-2 country, if known. */
export function continentOf(country: string | undefined): string | undefined {
  return country ? COUNTRY_TO_CONTINENT[country.toUpperCase()] : undefined;
}

const clean = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;
  const v = value.trim();
  if (!v || v === "XX" || v === "T1" || v.toLowerCase() === "unknown") return undefined;
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};

/** Fill `continent` from `country` when missing and uppercase codes. */
export function normalizeGeo(geo: GeoInfo): GeoInfo {
  const out: GeoInfo = { ...geo };
  if (out.country) out.country = out.country.toUpperCase();
  if (out.continent) out.continent = out.continent.toUpperCase();
  else if (out.country) {
    const c = continentOf(out.country);
    if (c) out.continent = c;
  }
  return out;
}

/** Options for {@link headerGeo}. */
export interface HeaderGeoOptions {
  country?: string;
  region?: string;
  city?: string;
  continent?: string;
  latitude?: string;
  longitude?: string;
}

/** Read geo from arbitrary request headers (any CDN or proxy that sets them). */
export function headerGeo(names: HeaderGeoOptions): GeoResolver {
  return (request) => {
    const h = request.headers;
    const read = (name?: string) => (name ? clean(h.get(name)) : undefined);
    const lat = read(names.latitude);
    const lon = read(names.longitude);
    const geo: GeoInfo = {};
    const country = read(names.country);
    if (country) geo.country = country;
    const region = read(names.region);
    if (region) geo.region = region;
    const city = read(names.city);
    if (city) geo.city = city;
    const continent = read(names.continent);
    if (continent) geo.continent = continent;
    if (lat && !Number.isNaN(Number(lat))) geo.latitude = Number(lat);
    if (lon && !Number.isNaN(Number(lon))) geo.longitude = Number(lon);
    return normalizeGeo(geo);
  };
}

/**
 * Cloudflare: `request.cf` (Workers) with a `CF-IPCountry` header fallback
 * (any Cloudflare-proxied origin with IP geolocation enabled).
 */
export function cloudflareGeo(): GeoResolver {
  const fromHeaders = headerGeo({
    country: "cf-ipcountry",
    city: "cf-ipcity",
    continent: "cf-ipcontinent",
    region: "cf-region",
    latitude: "cf-iplatitude",
    longitude: "cf-iplongitude",
  });
  return (request, ip) => {
    const cf = (request as Request & { cf?: Record<string, unknown> }).cf;
    if (cf && typeof cf === "object") {
      const str = (v: unknown) => (typeof v === "string" ? clean(v) : undefined);
      const geo: GeoInfo = {};
      const country = str(cf.country);
      if (country) geo.country = country;
      const continent = str(cf.continent);
      if (continent) geo.continent = continent;
      const region = str(cf.region);
      if (region) geo.region = region;
      const city = str(cf.city);
      if (city) geo.city = city;
      const lat = Number(cf.latitude);
      const lon = Number(cf.longitude);
      if (cf.latitude !== undefined && !Number.isNaN(lat)) geo.latitude = lat;
      if (cf.longitude !== undefined && !Number.isNaN(lon)) geo.longitude = lon;
      if (geo.country) return normalizeGeo(geo);
    }
    return fromHeaders(request, ip);
  };
}

/** Vercel: `x-vercel-ip-*` headers. */
export function vercelGeo(): GeoResolver {
  return headerGeo({
    country: "x-vercel-ip-country",
    region: "x-vercel-ip-country-region",
    city: "x-vercel-ip-city",
    latitude: "x-vercel-ip-latitude",
    longitude: "x-vercel-ip-longitude",
  });
}

/** Fastly / CloudFront / generic proxies: tries the common country headers. */
export function edgeHeadersGeo(): GeoResolver {
  const resolvers = [
    cloudflareGeo(),
    vercelGeo(),
    headerGeo({
      country: "cloudfront-viewer-country",
      city: "cloudfront-viewer-city",
      region: "cloudfront-viewer-country-region",
    }),
    headerGeo({ country: "fastly-geo-country", city: "fastly-geo-city" }),
    headerGeo({ country: "x-country-code", city: "x-city", region: "x-region" }),
  ];
  return async (request, ip) => {
    for (const resolve of resolvers) {
      const geo = await resolve(request, ip);
      if (geo.country) return geo;
    }
    return {};
  };
}

/**
 * Best-effort client IP: `CF-Connecting-IP`, `True-Client-IP`, `X-Real-IP`,
 * then the first `X-Forwarded-For` entry. Only trust these behind a proxy that
 * sets them; pass `getIp` to the redirect handler otherwise.
 */
export function clientIp(request: Request): string | undefined {
  const h = request.headers;
  const direct =
    h.get("cf-connecting-ip") ??
    h.get("true-client-ip") ??
    h.get("x-real-ip") ??
    h.get("fly-client-ip");
  if (direct) return direct.trim();
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || undefined;
  return undefined;
}
