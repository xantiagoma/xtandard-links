/**
 * Core type definitions for `@xtandard/links`.
 *
 * This module is **types only** — no runtime code beyond tiny constants, no
 * dependencies. It is safe to import from the redirect hot path and from edge
 * runtimes. Runtime validation (which pulls in `valibot`) lives in
 * {@link ./validation}.
 *
 * Import from `@xtandard/links/schema` (also re-exported by the root).
 *
 * @module schema
 */

/** JSON-serializable value, used for metadata. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** A JSON object. */
export type JsonObject = { [key: string]: JsonValue };

/**
 * A duration for configuration options: milliseconds as a number, or a string
 * such as `"5s"`, `"30m"`, `"2h"`, `"90d"`. Parsed by {@link ./duration.durationToMs}.
 */
export type LinksDuration = number | `${number}${"ms" | "s" | "m" | "h" | "d"}`;

/** Identity captured on audit records and passed by callers of audited mutations. */
export interface Actor {
  id: string;
  email?: string;
  name?: string;
}

/** Current schema version for stored records. */
export const SCHEMA_VERSION = 1 as const;

/** The tenant used when the host does not pass one (single-tenant installs). */
export const DEFAULT_TENANT = "default";

/**
 * A tenant is the unit of ownership — typically one of *your* customers or
 * workspaces. Links are scoped to a tenant; a viewer token grants read access
 * to exactly one tenant. Tenants are created implicitly by the first link.
 */
export interface Tenant {
  /** Unique key. Allowed characters: `a-z A-Z 0-9 . _ -`. */
  key: string;
  /** Optional human-friendly name. */
  name?: string;
  /** Arbitrary host-defined metadata (plan, limits, …). */
  metadata?: JsonObject;
  createdAt?: string;
  updatedAt?: string;
}

/** iOS app association for a domain (`apple-app-site-association`). */
export interface IosAppConfig {
  /** `TEAMID.bundle.id` values. */
  appIds: string[];
  /** Path patterns the app handles (AASA `components`). Default: every path. */
  paths?: string[];
}

/** Android app association for a domain (`assetlinks.json`). */
export interface AndroidAppConfig {
  packageName: string;
  /** SHA-256 signing certificate fingerprints (`AA:BB:…`). */
  sha256CertFingerprints: string[];
}

/**
 * A short-link domain (`go.acme.com`). Domains are either shared by every
 * tenant (`tenant` unset) or owned by one tenant (a customer's branded domain).
 * DNS and TLS for the hostname are the host's responsibility.
 */
export interface Domain {
  /** Lowercase hostname, no scheme or port, e.g. `"go.acme.com"`. */
  hostname: string;
  /** Owning tenant; unset = shared domain any tenant may use. */
  tenant?: string;
  /** Where the bare domain (`/`) redirects. Unset = fall through / 404. */
  rootUrl?: string;
  /** Where unknown slugs redirect. Unset = 404 page / fall through. */
  notFoundUrl?: string;
  /** Match slugs case-sensitively. Default `false` (ADR 0012). */
  caseSensitive?: boolean;
  /** Length of generated slugs on this domain. Default 7. */
  slugLength?: number;
  /** Deep-link association files served from `/.well-known/` (ADR 0008). */
  apps?: { ios?: IosAppConfig; android?: AndroidAppConfig[] };
  /** Default for new links on this domain. */
  isDefault?: boolean;
  /** Arbitrary host-defined metadata. */
  metadata?: JsonObject;
  createdAt?: string;
  updatedAt?: string;
}

/** UTM parameters merged into the destination's query string. */
export interface Utm {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

/** Link-preview (Open Graph) overrides served to unfurlers. */
export interface LinkPreview {
  title?: string;
  description?: string;
  image?: string;
}

/** A stored password verifier (PBKDF2-SHA256, Web Crypto). Never returned by the API. */
export interface PasswordHash {
  algorithm: "pbkdf2-sha256";
  iterations: number;
  /** base64url salt. */
  salt: string;
  /** base64url derived key. */
  hash: string;
}

/** Fields a rule condition can test (ADR 0011). */
export type ConditionField =
  | "device"
  | "os"
  | "browser"
  | "country"
  | "continent"
  | "language"
  | "referrer"
  | "qr";

/** A condition over a request dimension: `field` value is (not) one of `values`. */
export interface ValueCondition {
  field: ConditionField;
  op: "in" | "not_in";
  /** Compared case-insensitively. For `qr`, use `"true"` / `"false"`. */
  values: string[];
}

/** A condition on a query-string parameter of the short URL. */
export interface QueryCondition {
  field: "query";
  key: string;
  op: "in" | "not_in" | "exists" | "missing";
  values?: string[];
}

/** A time-window condition (ISO-8601 bounds, either optional). */
export interface TimeCondition {
  field: "time";
  after?: string;
  before?: string;
}

/** Any rule condition. */
export type Condition = ValueCondition | QueryCondition | TimeCondition;

/** A weighted A/B destination. */
export interface Variant {
  /** Stable id recorded on clicks (default: the index as a string). */
  id?: string;
  url: string;
  /** Relative weight (> 0). */
  weight: number;
}

/**
 * A targeting rule: when every condition matches, redirect to `url` or pick one
 * of `variants` deterministically per visitor. Rules are evaluated in order;
 * the first match wins (ADR 0011).
 */
export interface LinkRule {
  id: string;
  /** Optional label shown in the UI. */
  name?: string;
  /** ANDed conditions. An empty list always matches (useful for a pure A/B split). */
  when: Condition[];
  url?: string;
  variants?: Variant[];
}

/** Deep-link settings for a link (ADR 0008). */
export interface LinkDeepLink {
  /** In-app path handed to the app on (deferred) open, e.g. `"/product/42"`. */
  path?: string;
  /** Store a deferred handoff on mobile clicks so the app can claim it after install. */
  deferred?: boolean;
}

/** HTTP status used for the redirect. */
export type RedirectStatus = 301 | 302 | 307 | 308;

/** A short link. */
export interface Link {
  /** `"lnk_…"`, server-generated. */
  id: string;
  tenant: string;
  /** Hostname of the short domain. */
  domain: string;
  /** Slug as written (display form). Matching uses the normalized key (ADR 0012). */
  slug: string;
  /** Default destination (absolute http(s) URL, or an app scheme URL). */
  url: string;
  title?: string;
  description?: string;
  tags: string[];
  /** Host-side id for idempotent upserts and lookups. Unique per tenant. */
  externalId?: string;
  /** ISO-8601; after it the link is expired. */
  expiresAt?: string;
  /** Where expired links go. Unset = 410 page. */
  expiredUrl?: string;
  /** Expire after this many (non-bot) clicks. Enforced best-effort (ADR 0002). */
  maxClicks?: number;
  /** Present when the link is password-protected. */
  password?: PasswordHash;
  utm?: Utm;
  /** Link-preview overrides for unfurlers (Slack, X, iMessage, …). */
  preview?: LinkPreview;
  rules: LinkRule[];
  /** Destination for iOS visitors who reach the server (e.g. App Store listing). */
  ios?: string;
  /** Destination for Android visitors who reach the server (e.g. Play Store listing). */
  android?: string;
  deepLink?: LinkDeepLink;
  /** Default `302`. */
  redirectStatus?: RedirectStatus;
  /** Append the click id to the destination for conversion attribution (ADR 0010). */
  trackConversions?: boolean;
  /** Forward the short URL's query string to the destination. Default `true`. */
  passQuery?: boolean;
  /** Let search engines index the short URL. Default `false` (`X-Robots-Tag: noindex`). */
  indexable?: boolean;
  disabled?: boolean;
  archived?: boolean;
  /** Approximate non-bot click counter, used for `maxClicks` and list views. */
  clicks?: number;
  metadata?: JsonObject;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

/** Where a slug points: the owning tenant and link id. */
export interface SlugPointer {
  tenant: string;
  id: string;
}

/** Device class derived from the user agent. */
export type DeviceType = "desktop" | "mobile" | "tablet" | "tv" | "console" | "bot" | "unknown";

/** Geo information resolved for a request. */
export interface GeoInfo {
  /** ISO 3166-1 alpha-2, uppercase. */
  country?: string;
  /** Two-letter continent code (`EU`, `NA`, …). */
  continent?: string;
  region?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
}

/** Fields common to every analytics event. */
export interface AnalyticsEventBase {
  id: string;
  /** ISO-8601 time the event happened. */
  at: string;
  tenant: string;
  linkId: string;
  domain: string;
  slug: string;
}

/** A recorded click on a short link. Its `id` is the attribution click id. */
export interface ClickEvent extends AnalyticsEventBase {
  type: "click";
  /** The final destination the visitor was sent to. */
  destination: string;
  ruleId?: string;
  variant?: string;
  country?: string;
  continent?: string;
  region?: string;
  city?: string;
  device: DeviceType;
  os: string;
  browser: string;
  /** Primary Accept-Language tag, lowercase (`"en"`). */
  language?: string;
  referrer?: string;
  /** Referrer hostname, or `"(direct)"`. */
  referrerHost: string;
  /** Per the privacy mode: dropped (default), truncated, hashed, or full. */
  ip?: string;
  /** Daily-salted visitor hash (privacy mode `visitor: "daily-hash"`). */
  visitor?: string;
  /** Raw user agent (only when `privacy.userAgent` is `"full"`). */
  userAgent?: string;
  bot: boolean;
  /** The click came from a generated QR code (`?qr=1`). */
  qr: boolean;
  utm?: Utm;
}

/** A lead (signup) attributed to a click (ADR 0010). */
export interface LeadEvent extends AnalyticsEventBase, ClickDimensions {
  type: "lead";
  clickId: string;
  customerId: string;
  /** Event name, e.g. `"Sign up"`. */
  name: string;
  metadata?: JsonObject;
}

/** A sale attributed to a click through its customer (ADR 0010). */
export interface SaleEvent extends AnalyticsEventBase, ClickDimensions {
  type: "sale";
  clickId: string;
  customerId: string;
  name: string;
  /** Amount in minor units (cents). */
  amount: number;
  /** ISO 4217, uppercase. */
  currency: string;
  invoiceId?: string;
  metadata?: JsonObject;
}

/** Any event flowing into the analytics sink. */
export type AnalyticsEvent = ClickEvent | LeadEvent | SaleEvent;

/** Minimal click record kept in storage for attribution (pruned after the window). */
export interface ClickRef extends ClickDimensions {
  clickId: string;
  tenant: string;
  linkId: string;
  domain: string;
  slug: string;
  at: string;
}

/**
 * The click's dimensions, copied onto the click ref and onto the lead/sale events it
 * attributes, so conversions break down by country, device, referrer, … like clicks do.
 */
export interface ClickDimensions {
  country?: string;
  continent?: string;
  city?: string;
  device?: DeviceType;
  os?: string;
  browser?: string;
  referrerHost?: string;
  qr?: boolean;
  variant?: string;
  utm?: Utm;
}

/** A host customer bound to the click that brought them (first lead wins). */
export interface Customer {
  /** The host's customer id. */
  id: string;
  tenant: string;
  clickId: string;
  linkId: string;
  name?: string;
  email?: string;
  firstSeenAt: string;
  metadata?: JsonObject;
}

/** A pending deferred deep-link handoff (ADR 0008). */
export interface DeferredHandoff {
  clickId: string;
  tenant: string;
  linkId: string;
  /** In-app path to open. */
  path: string;
  /** Destination URL the visitor was sent to. */
  url: string;
  os: string;
  at: string;
  expiresAt: string;
  claimedAt?: string;
}

/** One entry in the internal operator audit log. */
export interface AuditEntry {
  at: string;
  action: string;
  actor: Actor | null;
  /** Target identifier (`link:lnk_…`, `domain:go.acme.com`, …). */
  target: string;
  /** Before/after snapshot or a short summary. */
  details?: JsonObject;
}
