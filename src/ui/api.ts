/**
 * The admin SPA's HTTP client for the panel API (`createFetchHandler`). Module
 * state (base URL, credentials, fetch, viewer token) is set once by the
 * bundled SPA or the React embeds — one embed per page, like the siblings.
 *
 * @module
 */

import type { AnalyticsDimension, AnalyticsInterval } from "../analytics/contract.ts";
import type { CreateLinkInput, UpdateLinkInput } from "../core.ts";
import type {
  AnalyticsEvent,
  AnalyticsResult,
  AuditEntry,
  Customer,
  Domain,
  ImportResult,
  LinkPage,
  LinksConfig,
  PublicLink,
  Tenant,
} from "./types.ts";
import { LinksApiError } from "./types.ts";
import { createApiClient, toQuery, type ApiClient } from "@xtandard/kit/ui";

export type { CreateLinkInput, UpdateLinkInput };

/**
 * The links API client (`@xtandard/kit/ui`'s): a base URL (empty by default,
 * so the bundled SPA uses relative URLs resolved against the injected
 * `<base href>`), the `credentials` mode, an optional custom `fetch`, and the
 * viewer token sent as `Authorization: Bearer lvt_…`. Non-2xx responses throw
 * {@link LinksApiError}. Each product has its own client, so two dashboards on
 * one page never share a base URL or token.
 */
const client = createApiClient({ errorClass: LinksApiError });

export type { ApiClientOptions, FetchLike } from "@xtandard/kit/ui";

/** Point the API client at a base URL (used by the `@xtandard/links/react` export). */
export const setApiBase: ApiClient["setApiBase"] = client.setApiBase;

/** Attach an analytics viewer token (`lvt_…`) as a Bearer credential on every request. */
export const setApiToken: ApiClient["setApiToken"] = client.setApiToken;

/** The attached viewer token, if any. */
export const getApiToken: ApiClient["getApiToken"] = client.getApiToken;

/** Absolute-or-relative URL for an API path. */
export const apiUrl: ApiClient["apiUrl"] = client.apiUrl;

/** Build a query string, skipping empty values. Arrays are comma-joined. */
export { toQuery } from "@xtandard/kit/ui";

const { send, req } = client;

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

const seg = encodeURIComponent;
const tenantBase = (tenant: string): string => `api/tenants/${seg(tenant)}`;

/* ─── Config + tenants ──────────────────────────────────────────────────────── */

export const getConfig = (): Promise<LinksConfig> => req("config");

export const listTenants = (): Promise<Tenant[]> => req("api/tenants");

export const upsertTenant = (tenant: Tenant): Promise<Tenant> =>
  req(`api/tenants/${seg(tenant.key)}`, json("PUT", tenant));

/* ─── Domains ───────────────────────────────────────────────────────────────── */

export const listDomains = (tenant?: string): Promise<Domain[]> =>
  req(`api/domains${toQuery({ tenant })}`);

export const createDomain = (domain: Domain): Promise<Domain> =>
  req("api/domains", json("POST", domain));

export const updateDomain = (hostname: string, patch: Partial<Domain>): Promise<Domain> =>
  req(`api/domains/${seg(hostname)}`, json("PUT", patch));

export const deleteDomain = (hostname: string, force = false): Promise<{ ok: boolean }> =>
  req(`api/domains/${seg(hostname)}${toQuery({ force: force || undefined })}`, {
    method: "DELETE",
  });

/* ─── Links ─────────────────────────────────────────────────────────────────── */

export interface LinkFilters {
  search?: string;
  tag?: string;
  domain?: string;
  archived?: "true" | "false" | "all";
  limit?: number;
  cursor?: string;
}

export const listLinks = (tenant: string, filters: LinkFilters = {}): Promise<LinkPage> =>
  req(`${tenantBase(tenant)}/links${toQuery({ ...filters })}`);

export const getLink = (tenant: string, id: string): Promise<PublicLink> =>
  req(`${tenantBase(tenant)}/links/${seg(id)}`);

export const createLink = (tenant: string, input: CreateLinkInput): Promise<PublicLink> =>
  req(`${tenantBase(tenant)}/links`, json("POST", input));

export const updateLink = (
  tenant: string,
  id: string,
  patch: UpdateLinkInput,
): Promise<PublicLink> => req(`${tenantBase(tenant)}/links/${seg(id)}`, json("PATCH", patch));

export const deleteLink = (tenant: string, id: string): Promise<{ ok: boolean }> =>
  req(`${tenantBase(tenant)}/links/${seg(id)}`, { method: "DELETE" });

export const listTags = (tenant: string): Promise<{ tag: string; count: number }[]> =>
  req(`${tenantBase(tenant)}/tags`);

export interface QrOptions {
  size?: number;
  margin?: number;
  fg?: string;
  bg?: string;
  ecc?: "L" | "M" | "Q" | "H";
}

/** The link's QR code as SVG markup (fetched, so viewer tokens apply). */
export async function getQrSvg(tenant: string, id: string, opts: QrOptions = {}): Promise<string> {
  const res = await send(`${tenantBase(tenant)}/links/${seg(id)}/qr.svg${toQuery({ ...opts })}`);
  return res.text();
}

/** The tenant's links as a native-format CSV (the import format round-trips). */
export async function exportLinksCsv(tenant: string, filters: LinkFilters = {}): Promise<Blob> {
  const res = await send(`${tenantBase(tenant)}/links.csv${toQuery({ ...filters })}`);
  return res.blob();
}

/* ─── Import ────────────────────────────────────────────────────────────────── */

export type ImportFormat = "auto" | "native" | "bitly" | "dub" | "shlink" | "kutt";
export type ImportConflict = "skip" | "update" | "error";

export interface ImportOptions {
  format?: ImportFormat;
  dryRun?: boolean;
  onConflict?: ImportConflict;
  /** Put every row on this domain unless `keepDomains`. */
  domain?: string;
  keepDomains?: boolean;
  /** Extra tags added to every row. */
  tags?: string[];
}

export const importCsv = (
  tenant: string,
  csv: string,
  opts: ImportOptions = {},
): Promise<ImportResult> =>
  req(
    `${tenantBase(tenant)}/links/import${toQuery({
      format: opts.format,
      dryRun: opts.dryRun || undefined,
      onConflict: opts.onConflict,
      domain: opts.domain,
      keepDomains: opts.keepDomains || undefined,
      tags: opts.tags,
    })}`,
    { method: "POST", body: csv, headers: { "Content-Type": "text/csv" } },
  );

/* ─── Customers + audit ─────────────────────────────────────────────────────── */

export const listCustomers = (tenant: string): Promise<Customer[]> =>
  req(`${tenantBase(tenant)}/customers`);

export const listAudit = (tenant?: string): Promise<AuditEntry[]> =>
  req(tenant ? `${tenantBase(tenant)}/audit` : "api/audit");

/* ─── Analytics ─────────────────────────────────────────────────────────────── */

export interface AnalyticsParams {
  from: string;
  to: string;
  interval?: AnalyticsInterval | "none";
  groupBy?: AnalyticsDimension;
  linkIds?: string[];
  limit?: number;
  filters?: Partial<Record<AnalyticsDimension, string[]>>;
}

/** Query string for an analytics request (`filter[country]=US,DE`). */
export function analyticsQueryString(p: AnalyticsParams): string {
  const params: Record<string, string | number | string[] | undefined> = {
    from: p.from,
    to: p.to,
    interval: p.interval,
    groupBy: p.groupBy,
    linkIds: p.linkIds,
    limit: p.limit,
  };
  for (const [dim, values] of Object.entries(p.filters ?? {})) {
    if (values?.length) params[`filter[${dim}]`] = values;
  }
  return toQuery(params);
}

export const getAnalytics = (tenant: string, p: AnalyticsParams): Promise<AnalyticsResult> =>
  req(`${tenantBase(tenant)}/analytics${analyticsQueryString(p)}`);

export interface EventsParams {
  linkIds?: string[];
  types?: AnalyticsEvent["type"][];
  before?: string;
  limit?: number;
  includeBots?: boolean;
}

export const listEvents = (tenant: string, p: EventsParams = {}): Promise<AnalyticsEvent[]> =>
  req(
    `${tenantBase(tenant)}/events${toQuery({
      linkIds: p.linkIds,
      types: p.types,
      before: p.before,
      limit: p.limit,
      includeBots: p.includeBots || undefined,
    })}`,
  );

/* ─── Viewer tokens ─────────────────────────────────────────────────────────── */

export interface ViewerTokenInput {
  links?: string[];
  allow?: string[];
  expiresIn?: string;
}

export const createViewerToken = (
  tenant: string,
  input: ViewerTokenInput,
): Promise<{ token: string; expiresAt: string }> =>
  req(`${tenantBase(tenant)}/viewer-tokens`, json("POST", input));
