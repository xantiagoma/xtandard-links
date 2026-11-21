/**
 * Bulk import and export of links as CSV.
 *
 * - {@link parseLinksCsv} turns a CSV export from another shortener (or our own
 *   {@link linksToCsv} export) into `CreateLinkInput` rows for
 *   `core.importLinks(tenant, rows, { dryRun, onConflict })`. Row `i` of the
 *   result is data row `i` of the file, so import errors point at file rows.
 * - {@link linksToCsv} exports links in the `native` format (round-trips).
 *
 * Column maps are header-alias based and tolerant: headers are compared after
 * lowercasing and dropping everything but letters and digits (`"Long URL"`,
 * `"long_url"` and `"longUrl"` all read as `longurl`), and unknown columns are
 * ignored. Assumptions per format (vendor exports change; extra aliases are
 * cheap — every map also accepts the API field names):
 *
 * | format   | destination                          | slug / short link                                   | other                                              |
 * | -------- | ------------------------------------ | --------------------------------------------------- | -------------------------------------------------- |
 * | `native` | `url`                                | `slug` (+ `domain`)                                 | every column {@link linksToCsv} writes             |
 * | `bitly`  | `Destination URL`, `Long URL`, `long_url` | `Custom Bitlink` / `custom_bitlinks`, else `Bitlink` / `Short link` / `link` (path → slug) | `Title`, `Tags`, `Archived`                   |
 * | `dub`    | `Destination URL`, `url`             | `key`, else `Short link` / `shortLink` (path → slug) | `domain`, `title`, `description`, `tags`, `externalId`, `expiresAt`, `archived`, `utm_*`, `ios`, `android` |
 * | `shlink` | `Long URL`, `longUrl`                | `Short code`, `shortCode`, else `shortUrl`          | `domain`, `title`, `tags` (`\|`-separated), `validUntil`, `maxVisits` |
 * | `kutt`   | `target`                             | `address`, else `link` / `shortUrl`                 | `domain`, `description`, `expire_in`               |
 *
 * Bitly's dashboard export (paid plans) has *Title, Bitlink, Custom Bitlink,
 * Destination URL, Date created, Engagements*; its API uses `long_url`,
 * `title`, `tags`, `custom_bitlinks`. Dub's dashboard export defaults to
 * *Short link, Destination URL, Clicks, Created at* with optional columns
 * named after its API (`key`, `domain`, `title`, `tags`, …). Shlink's own
 * importer and web-client export use *Short code / Long URL / Title / Domain /
 * Tags* (`shortCode`, `longUrl`, …). Kutt has no first-party CSV export; the
 * map follows its API's link object (`address`, `target`, `description`,
 * `domain`, `expire_in`).
 *
 * Domains: foreign formats drop the source domain by default (`bit.ly` is not
 * yours), so links land on the tenant's default domain; pass
 * `keepDomains: true` when migrating a branded domain you have registered, or
 * `domain` to put every row on one domain. `native` keeps domains.
 *
 * Import from `@xtandard/links/import`.
 *
 * @module import
 */

import type { CreateLinkInput } from "./core.ts";
import { parseCsvRecords, stringifyCsv, type CsvValue } from "./csv.ts";
import type { JsonObject, Link } from "./schema.ts";

export { CsvParseError, parseCsv, parseCsvRecords, stringifyCsv } from "./csv.ts";

/** Supported source formats. `auto` picks one from the header row. */
export type LinksCsvFormat = "native" | "bitly" | "dub" | "shlink" | "kutt";

/** Every supported format. */
export const LINKS_CSV_FORMATS: readonly LinksCsvFormat[] = [
  "native",
  "bitly",
  "dub",
  "shlink",
  "kutt",
];

/** Options for {@link parseLinksCsv}. */
export interface ParseLinksCsvOptions {
  /** Source format. Default `"auto"` ({@link detectLinksCsvFormat}). */
  format?: LinksCsvFormat | "auto";
  /** Put every row on this domain. */
  domain?: string;
  /** Keep the source domain of each row. Default `true` for `native`, `false` otherwise. */
  keepDomains?: boolean;
  /** Tags added to every row (e.g. `["imported"]`). */
  tags?: string[];
  /** Field delimiter. Default `","`. */
  delimiter?: string;
}

type Field =
  | "url"
  | "slug"
  | "shortUrl"
  | "domain"
  | "title"
  | "description"
  | "tags"
  | "externalId"
  | "expiresAt"
  | "expiredUrl"
  | "maxClicks"
  | "archived"
  | "disabled"
  | "ios"
  | "android"
  | "utmSource"
  | "utmMedium"
  | "utmCampaign"
  | "utmTerm"
  | "utmContent"
  | "redirectStatus"
  | "trackConversions"
  | "passQuery"
  | "indexable"
  | "previewTitle"
  | "previewDescription"
  | "previewImage"
  | "deepLinkPath"
  | "deepLinkDeferred"
  | "rules"
  | "metadata";

type ColumnMap = Partial<Record<Field, string[]>>;

const UTM: ColumnMap = {
  utmSource: ["utmsource"],
  utmMedium: ["utmmedium"],
  utmCampaign: ["utmcampaign"],
  utmTerm: ["utmterm"],
  utmContent: ["utmcontent"],
};

/** Header aliases (normalized) per format, in priority order. */
const MAPS: Record<LinksCsvFormat, ColumnMap> = {
  native: {
    url: ["url"],
    slug: ["slug"],
    shortUrl: ["shorturl"],
    domain: ["domain"],
    title: ["title"],
    description: ["description"],
    tags: ["tags"],
    externalId: ["externalid"],
    expiresAt: ["expiresat"],
    expiredUrl: ["expiredurl"],
    maxClicks: ["maxclicks"],
    archived: ["archived"],
    disabled: ["disabled"],
    ios: ["ios"],
    android: ["android"],
    ...UTM,
    redirectStatus: ["redirectstatus"],
    trackConversions: ["trackconversions"],
    passQuery: ["passquery"],
    indexable: ["indexable"],
    previewTitle: ["previewtitle"],
    previewDescription: ["previewdescription"],
    previewImage: ["previewimage"],
    deepLinkPath: ["deeplinkpath"],
    deepLinkDeferred: ["deeplinkdeferred"],
    rules: ["rules"],
    metadata: ["metadata"],
  },
  bitly: {
    url: ["destinationurl", "longurl", "originalurl", "url"],
    shortUrl: ["custombitlink", "custombitlinks", "bitlink", "bitlylink", "shortlink", "link"],
    title: ["title"],
    tags: ["tags"],
    archived: ["archived"],
  },
  dub: {
    url: ["destinationurl", "url"],
    slug: ["key", "shortkey"],
    shortUrl: ["shortlink", "link"],
    domain: ["domain"],
    title: ["title"],
    description: ["description"],
    tags: ["tags", "tagnames"],
    externalId: ["externalid"],
    expiresAt: ["expiresat"],
    expiredUrl: ["expiredurl"],
    archived: ["archived"],
    ios: ["ios"],
    android: ["android"],
    ...UTM,
    trackConversions: ["trackconversion", "trackconversions"],
  },
  shlink: {
    url: ["longurl", "originalurl"],
    slug: ["shortcode"],
    shortUrl: ["shorturl"],
    domain: ["domain"],
    title: ["title"],
    tags: ["tags"],
    expiresAt: ["validuntil"],
    maxClicks: ["maxvisits"],
  },
  kutt: {
    url: ["target", "targeturl", "originalurl"],
    slug: ["address", "customurl"],
    shortUrl: ["link", "shorturl"],
    domain: ["domain"],
    description: ["description"],
    expiresAt: ["expirein", "expiresat"],
  },
};

/** Normalize a header for alias matching: lowercase letters and digits only. */
export const normalizeHeader = (header: string): string =>
  header.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Headers that identify a format (normalized), checked in order. */
const SIGNATURES: [LinksCsvFormat, string[]][] = [
  ["native", ["slug", "url", "domain"]],
  ["shlink", ["shortcode"]],
  ["shlink", ["longurl", "shorturl"]],
  ["kutt", ["target", "address"]],
  ["bitly", ["bitlink"]],
  ["bitly", ["custombitlink"]],
  ["bitly", ["longurl"]],
  ["dub", ["key", "url"]],
  ["dub", ["shortlink"]],
];

/** Guess the source format from a header row. Defaults to `native`. */
export function detectLinksCsvFormat(headers: readonly string[]): LinksCsvFormat {
  const set = new Set(headers.map(normalizeHeader));
  for (const [format, required] of SIGNATURES) {
    if (required.every((h) => set.has(h))) return format;
  }
  return "native";
}

const TRUE = new Set(["true", "1", "yes", "y"]);
const FALSE = new Set(["false", "0", "no", "n"]);

function bool(value: string): boolean | undefined {
  const v = value.trim().toLowerCase();
  if (TRUE.has(v)) return true;
  if (FALSE.has(v)) return false;
  return undefined;
}

/** ISO-8601 for any date `Date.parse` understands; the raw value otherwise (fails validation). */
function isoDate(value: string): string {
  const t = Date.parse(value);
  return Number.isNaN(t) ? value : new Date(t).toISOString();
}

function splitTags(value: string): string[] {
  return value
    .split(/[,|;]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Split a short link (`https://bit.ly/abc`, `bit.ly/abc`) into domain + slug. */
function splitShortUrl(value: string): { domain?: string; slug?: string } {
  const raw = (value.split(/[\s,|]+/).find(Boolean) ?? "").trim();
  if (!raw) return {};
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    const slug = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, "");
    return { domain: url.hostname.toLowerCase(), ...(slug ? { slug } : {}) };
  } catch {
    return {};
  }
}

function parseJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

/**
 * Parse a links CSV into `CreateLinkInput` rows.
 *
 * @example
 * ```ts
 * import { parseLinksCsv } from "@xtandard/links/import";
 *
 * const rows = parseLinksCsv(await Bun.file("bitly-export.csv").text(), { format: "bitly" });
 * const result = await core.importLinks("acme", rows, { onConflict: "skip" });
 * ```
 */
export function parseLinksCsv(text: string, options: ParseLinksCsvOptions = {}): CreateLinkInput[] {
  const { headers, records } = parseCsvRecords(
    text,
    options.delimiter ? { delimiter: options.delimiter } : {},
  );
  const format =
    !options.format || options.format === "auto" ? detectLinksCsvFormat(headers) : options.format;
  const map = MAPS[format];
  const keepDomains = options.keepDomains ?? format === "native";

  const byNormalized = new Map<string, string>();
  for (const h of headers) {
    const n = normalizeHeader(h);
    if (!byNormalized.has(n)) byNormalized.set(n, h);
  }
  // Every present header per field, by alias priority; the first non-empty value wins
  // (an empty "Custom Bitlink" falls back to "Bitlink").
  const columns: Partial<Record<Field, string[]>> = {};
  for (const [field, aliases] of Object.entries(map) as [Field, string[]][]) {
    const present = aliases
      .map((alias) => byNormalized.get(alias))
      .filter((h): h is string => h !== undefined);
    if (present.length) columns[field] = present;
  }

  return records.map((record) => {
    const get = (field: Field): string => {
      for (const header of columns[field] ?? []) {
        const value = (record[header] ?? "").trim();
        if (value) return value;
      }
      return "";
    };
    const input: CreateLinkInput = { url: get("url") };

    let slug = get("slug") || undefined;
    let domain = get("domain") || undefined;
    const short = get("shortUrl");
    if (short) {
      const parsed = splitShortUrl(short);
      slug ??= parsed.slug;
      domain ??= parsed.domain;
    }
    if (slug) input.slug = slug;
    if (options.domain) input.domain = options.domain.toLowerCase();
    else if (keepDomains && domain) input.domain = domain.toLowerCase();

    const title = get("title");
    if (title) input.title = title;
    const description = get("description");
    if (description) input.description = description;
    const tags = [...splitTags(get("tags")), ...(options.tags ?? [])];
    if (tags.length) input.tags = [...new Set(tags)];
    const externalId = get("externalId");
    if (externalId) input.externalId = externalId;
    const expiresAt = get("expiresAt");
    if (expiresAt) input.expiresAt = isoDate(expiresAt);
    const expiredUrl = get("expiredUrl");
    if (expiredUrl) input.expiredUrl = expiredUrl;
    const maxClicks = get("maxClicks");
    if (maxClicks && Number(maxClicks) > 0) input.maxClicks = Math.floor(Number(maxClicks));
    const ios = get("ios");
    if (ios) input.ios = ios;
    const android = get("android");
    if (android) input.android = android;

    const utm: NonNullable<Link["utm"]> = {};
    const utmFields = [
      ["utmSource", "source"],
      ["utmMedium", "medium"],
      ["utmCampaign", "campaign"],
      ["utmTerm", "term"],
      ["utmContent", "content"],
    ] as const;
    for (const [field, key] of utmFields) {
      const value = get(field);
      if (value) utm[key] = value;
    }
    if (Object.keys(utm).length) input.utm = utm;

    const preview: NonNullable<Link["preview"]> = {};
    if (get("previewTitle")) preview.title = get("previewTitle");
    if (get("previewDescription")) preview.description = get("previewDescription");
    if (get("previewImage")) preview.image = get("previewImage");
    if (Object.keys(preview).length) input.preview = preview;

    const deepLinkPath = get("deepLinkPath");
    const deepLinkDeferred = bool(get("deepLinkDeferred"));
    if (deepLinkPath || deepLinkDeferred !== undefined) {
      input.deepLink = {
        ...(deepLinkPath ? { path: deepLinkPath } : {}),
        ...(deepLinkDeferred !== undefined ? { deferred: deepLinkDeferred } : {}),
      };
    }

    const status = Number(get("redirectStatus"));
    if (status === 301 || status === 302 || status === 307 || status === 308) {
      input.redirectStatus = status;
    }
    for (const field of [
      "archived",
      "disabled",
      "trackConversions",
      "passQuery",
      "indexable",
    ] as const) {
      const value = bool(get(field));
      if (value !== undefined) input[field] = value;
    }

    const rules = get("rules");
    if (rules) {
      const parsed = parseJson<CreateLinkInput["rules"]>(rules);
      if (Array.isArray(parsed) && parsed.length) input.rules = parsed;
    }
    const metadata = get("metadata");
    if (metadata) {
      const parsed = parseJson<JsonObject>(metadata);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input.metadata = parsed;
    }
    return input;
  });
}

/** The columns {@link linksToCsv} writes, in order. */
export const NATIVE_CSV_COLUMNS = [
  "id",
  "domain",
  "slug",
  "short_url",
  "url",
  "title",
  "description",
  "tags",
  "external_id",
  "expires_at",
  "expired_url",
  "max_clicks",
  "ios",
  "android",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "redirect_status",
  "track_conversions",
  "pass_query",
  "indexable",
  "disabled",
  "archived",
  "preview_title",
  "preview_description",
  "preview_image",
  "deep_link_path",
  "deep_link_deferred",
  "rules",
  "metadata",
  "clicks",
  "created_at",
] as const;

/** Options for {@link linksToCsv}. */
export interface LinksToCsvOptions {
  /** Build the `short_url` column. Default `https://{domain}/{slug}`. */
  shortUrl?: (link: Pick<Link, "domain" | "slug">) => string;
}

/**
 * Export links as CSV in the `native` format (every column re-imports;
 * passwords are never exported). Tags are comma-joined.
 */
export function linksToCsv(
  links: readonly Omit<Link, "password">[],
  options: LinksToCsvOptions = {},
): string {
  const short =
    options.shortUrl ?? ((l: Pick<Link, "domain" | "slug">) => `https://${l.domain}/${l.slug}`);
  const rows: CsvValue[][] = [[...NATIVE_CSV_COLUMNS]];
  for (const l of links) {
    rows.push([
      l.id,
      l.domain,
      l.slug,
      short(l),
      l.url,
      l.title,
      l.description,
      l.tags.join(","),
      l.externalId,
      l.expiresAt,
      l.expiredUrl,
      l.maxClicks,
      l.ios,
      l.android,
      l.utm?.source,
      l.utm?.medium,
      l.utm?.campaign,
      l.utm?.term,
      l.utm?.content,
      l.redirectStatus,
      l.trackConversions,
      l.passQuery,
      l.indexable,
      l.disabled,
      l.archived,
      l.preview?.title,
      l.preview?.description,
      l.preview?.image,
      l.deepLink?.path,
      l.deepLink?.deferred,
      l.rules.length ? JSON.stringify(l.rules) : "",
      l.metadata ? JSON.stringify(l.metadata) : "",
      l.clicks ?? 0,
      l.createdAt,
    ]);
  }
  return stringifyCsv(rows);
}
