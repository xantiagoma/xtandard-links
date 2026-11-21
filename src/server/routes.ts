/**
 * JSON admin API. A small method+pattern router over {@link LinksCore}, wired
 * to authentication, authorization, and analytics viewer-token scoping.
 * Returns `null` for non-API paths so the caller can fall through to
 * static-asset / SPA handling. Every route is documented in `docs/HTTP_API.md`
 * and described by the OpenAPI document (`./openapi.ts`).
 *
 * The analytics **widget** is not a separate route set — a request bearing a
 * valid `Authorization: Bearer lvt_…` token hits this same API with its
 * authorization force-scoped to the token's tenant, link set and actions (the
 * host's own auth/authorization providers are bypassed for viewer principals;
 * viewer scoping wins).
 *
 * @module
 */

import type { AnalyticsQuery, EventsQuery } from "../analytics/contract.ts";
import { ANALYTICS_DIMENSIONS, type AnalyticsDimension } from "../analytics/contract.ts";
import { UnsupportedQueryError } from "../analytics/kv.ts";
import type { AuthProvider, Principal } from "../auth/contract.ts";
import {
  isMutatingAction,
  type AuthorizationProvider,
  type LinksAction,
  type LinksResource,
} from "../authorization/contract.ts";
import {
  ConflictError,
  NotFoundError,
  publicLink,
  ReadonlyError,
  type CreateLinkInput,
  type ImportConflictPolicy,
  type LinksCore,
  type ListLinksQuery,
  type TrackLeadInput,
  type TrackSaleInput,
  type UpdateLinkInput,
} from "../core.ts";
import { CsvParseError } from "../csv.ts";
import { durationToMs } from "../duration.ts";
import { HookDeniedError } from "../hooks/contract.ts";
import { LINKS_CSV_FORMATS, linksToCsv, parseLinksCsv, type LinksCsvFormat } from "../import.ts";
import {
  createViewerToken,
  DEFAULT_VIEWER_ACTIONS,
  VIEWER_GRANTABLE_ACTIONS,
  VIEWER_TOKEN_PREFIX,
  ViewerTokenError,
  verifyViewerToken,
} from "../portal.ts";
import { qrUrl, renderQrSvg, type QrEcc } from "../qr.ts";
import {
  DEFAULT_TENANT,
  type Actor,
  type AnalyticsEvent,
  type Domain,
  type Link,
  type LinksDuration,
  type Tenant,
} from "../schema.ts";
import { ValidationError } from "../validation.ts";
import { VERSION } from "../version.ts";
import { buildOpenApiDocument } from "./openapi.ts";

/**
 * Viewer-token composition for the panel: when set, requests bearing a valid
 * `lvt_…` token act as a viewer principal scoped to the token's tenant.
 */
export interface LinksPortalOptions {
  /** The HMAC secret viewer tokens are minted with (`createViewerToken`). */
  secret: string;
  /**
   * Actions a viewer may perform when its token names none (always confined to
   * the token's tenant and link set). Default {@link DEFAULT_VIEWER_ACTIONS}.
   */
  allow?: LinksAction[];
}

/** Everything the API router needs. */
export interface ApiContext {
  core: LinksCore;
  auth: AuthProvider;
  authorization: AuthorizationProvider;
  title: string;
  readonly: boolean;
  basePath: string;
  logoUrl?: string;
  /** Viewer-token composition (see {@link LinksPortalOptions}). */
  portal?: LinksPortalOptions;
  /** Path prefix short links are served under, for QR URLs (redirect `basePath`). */
  redirectBasePath?: string;
}

/** The per-request scope a valid viewer token establishes. */
interface ViewerScope {
  tenant: string;
  links: ReadonlySet<string> | null;
  allow: ReadonlySet<LinksAction>;
  exp: number;
}

/** Thrown for malformed requests (bad JSON shape, bad query). Maps to 400. */
class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

/** Thrown when an optional capability is not configured. Maps to 501. */
class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotConfiguredError";
  }
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

const error = (status: number, message: string, extra?: Record<string, unknown>): Response =>
  json({ error: message, ...extra }, status);

/** Match `pattern` (with `:name` segments) against `path`. */
function match(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.split("/").filter(Boolean);
  const ap = path.split("/").filter(Boolean);
  if (pp.length !== ap.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    const seg = pp[i] as string;
    const val = ap[i] as string;
    if (seg.startsWith(":")) {
      try {
        params[seg.slice(1)] = decodeURIComponent(val);
      } catch {
        return null;
      }
    } else if (seg !== val) return null;
  }
  return params;
}

/** Build the audit {@link Actor} for a principal. */
function actorFor(principal: Principal): Actor {
  return {
    id: principal.id,
    ...(principal.email !== undefined ? { email: principal.email } : {}),
    ...(principal.name !== undefined ? { name: principal.name } : {}),
  };
}

/** Parse a positive-integer query param, or `undefined`. */
function intParam(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

const boolParam = (value: string | null): boolean | undefined =>
  value === null ? undefined : value === "true" || value === "1" || value === "";

const listParam = (value: string | null): string[] | undefined => {
  if (value === null) return undefined;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

async function readJsonObject<T>(request: Request): Promise<T> {
  const value = (await request.json()) as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestError("Expected a JSON object body");
  }
  return value as T;
}

/** Fields of a tenant a PUT may set. */
type TenantPatch = Pick<Tenant, "name" | "metadata">;

/** Everything one route handler needs. */
interface RouteContext {
  request: Request;
  url: URL;
  params: Record<string, string>;
  principal: Principal;
  scope: ViewerScope | null;
  actor: Actor;
  /** `null` when allowed, else the 403 response to return. */
  authorize(action: LinksAction, resource: LinksResource): Promise<Response | null>;
}

interface Route {
  method: string;
  pattern: string;
  handler: (rc: RouteContext) => Promise<Response>;
}

const LINK_FILTERS = ["search", "tag", "domain"] as const;

/** Apply `listLinks` filters to an in-memory set (link-scoped viewers). */
function filterLinks(links: Link[], query: ListLinksQuery): Link[] {
  let out = links;
  const archived = query.archived ?? false;
  if (archived !== "all") out = out.filter((l) => (l.archived ?? false) === archived);
  if (query.tag) out = out.filter((l) => l.tags.includes(query.tag as string));
  if (query.domain) {
    const d = query.domain.toLowerCase();
    out = out.filter((l) => l.domain === d);
  }
  if (query.search) {
    const s = query.search.toLowerCase();
    out = out.filter(
      (l) =>
        l.slug.toLowerCase().includes(s) ||
        l.url.toLowerCase().includes(s) ||
        l.domain.includes(s) ||
        (l.title ?? "").toLowerCase().includes(s) ||
        l.tags.some((t) => t.toLowerCase().includes(s)),
    );
  }
  return out.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** The resource a tenant-wide grant of `action` targets (viewer-token minting checks). */
function tenantResource(action: LinksAction, tenant: string): LinksResource {
  switch (action) {
    case "tenant:read":
    case "tenant:update":
    case "tenant:delete":
      return { type: "tenant", tenant };
    case "domain:read":
    case "domain:create":
    case "domain:update":
    case "domain:delete":
      return { type: "domain", hostname: "*", tenant };
    case "analytics:read":
      return { type: "analytics", tenant };
    case "customer:read":
      return { type: "customer", tenant };
    case "audit:read":
      return { type: "audit", tenant };
    case "conversion:track":
      return { type: "conversion", tenant };
    case "viewer-token:create":
      return { type: "viewer-token", tenant };
    default:
      return { type: "link", tenant };
  }
}

/** Build the API request handler for a context. */
export function createApiHandler(
  ctx: ApiContext,
): (request: Request, path: string) => Promise<Response | null> {
  const core = ctx.core;
  const isReadonly = () => ctx.readonly || core.readonly;

  /** Link ids a link-scoped viewer may see in an analytics/events query. */
  const clampLinkIds = (
    scope: ViewerScope | null,
    requested: string[] | undefined,
  ): string[] | undefined | Response => {
    if (!scope?.links) return requested;
    if (!requested) return [...scope.links];
    const allowed = requested.filter((id) => scope.links?.has(id));
    if (requested.length > 0 && allowed.length === 0) {
      return error(403, "Forbidden", { action: "analytics:read" });
    }
    return allowed;
  };

  /** All links of a tenant (every page), optionally restricted to a viewer's link set. */
  async function allLinks(tenant: string, scope: ViewerScope | null, query: ListLinksQuery) {
    if (scope?.links) {
      const found = await Promise.all([...scope.links].map((id) => core.getLink(tenant, id)));
      const links = filterLinks(
        found.filter((l): l is Link => l !== null),
        query,
      );
      for (const link of links) link.clicks = await core.getClickCount(tenant, link.id);
      return links;
    }
    const out: Link[] = [];
    let cursor: string | undefined;
    do {
      const page = await core.listLinks(tenant, {
        ...query,
        limit: 500,
        ...(cursor ? { cursor } : {}),
      });
      out.push(...page.links);
      cursor = page.nextCursor;
    } while (cursor);
    return out;
  }

  function linkQuery(url: URL): ListLinksQuery {
    const q = url.searchParams;
    const query: ListLinksQuery = {};
    for (const key of LINK_FILTERS) {
      const value = q.get(key);
      if (value) query[key] = value;
    }
    const archived = q.get("archived");
    if (archived === "true") query.archived = true;
    else if (archived === "all") query.archived = "all";
    else if (archived !== null && archived !== "false") {
      throw new BadRequestError('archived must be "true", "false" or "all"');
    }
    const limit = intParam(q.get("limit"));
    if (limit !== undefined) query.limit = limit;
    const cursor = q.get("cursor");
    if (cursor) query.cursor = cursor;
    return query;
  }

  function analyticsQuery(tenant: string, url: URL): AnalyticsQuery {
    const q = url.searchParams;
    const issues: { path: string; message: string }[] = [];
    const now = core.now();
    const to = q.get("to") ?? new Date(now).toISOString();
    const from = q.get("from") ?? new Date(Date.parse(to) - 30 * 86_400_000).toISOString();
    if (Number.isNaN(Date.parse(from))) issues.push({ path: "query.from", message: "not a date" });
    if (Number.isNaN(Date.parse(to))) issues.push({ path: "query.to", message: "not a date" });
    if (!issues.length && Date.parse(from) >= Date.parse(to)) {
      issues.push({ path: "query.from", message: "must be before `to`" });
    }
    const interval = q.get("interval") ?? "day";
    if (!["hour", "day", "none"].includes(interval)) {
      issues.push({ path: "query.interval", message: 'must be "hour", "day" or "none"' });
    }
    const groupBy = q.get("groupBy");
    if (groupBy && !ANALYTICS_DIMENSIONS.includes(groupBy as AnalyticsDimension)) {
      issues.push({
        path: "query.groupBy",
        message: `must be one of ${ANALYTICS_DIMENSIONS.join(", ")}`,
      });
    }
    const filters: Partial<Record<AnalyticsDimension, string[]>> = {};
    for (const [key, value] of q) {
      const m = /^filter\[([a-z_]+)\]$/.exec(key);
      if (!m) continue;
      const dim = m[1] as AnalyticsDimension;
      if (!ANALYTICS_DIMENSIONS.includes(dim)) {
        issues.push({ path: `query.${key}`, message: "unknown dimension" });
        continue;
      }
      filters[dim] = [...(filters[dim] ?? []), ...(listParam(value) ?? [])];
    }
    if (issues.length) throw new ValidationError(issues);
    const linkIds = listParam(q.get("linkIds"));
    const limit = intParam(q.get("limit"));
    return {
      tenant,
      from: new Date(Date.parse(from)).toISOString(),
      to: new Date(Date.parse(to)).toISOString(),
      ...(interval !== "none" ? { interval: interval as "hour" | "day" } : {}),
      ...(groupBy ? { groupBy: groupBy as AnalyticsDimension } : {}),
      ...(linkIds ? { linkIds } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(Object.keys(filters).length ? { filters } : {}),
    };
  }

  const linkPage = async (rc: RouteContext, tenant: string) => {
    const query = linkQuery(rc.url);
    if (rc.scope?.links) {
      const all = await allLinks(tenant, rc.scope, query);
      let start = 0;
      if (query.cursor) {
        const cursor = query.cursor;
        start = all.findIndex((l) => l.id < cursor);
        if (start < 0) start = all.length;
      }
      const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
      const page = all.slice(start, start + limit);
      const last = page[page.length - 1];
      return {
        links: page.map(publicLink),
        total: all.length,
        ...(start + limit < all.length && last ? { nextCursor: last.id } : {}),
      };
    }
    const page = await core.listLinks(tenant, query);
    return { ...page, links: page.links.map(publicLink) };
  };

  const routes: Route[] = [
    // ------------------------------------------------------------ tenants
    {
      method: "GET",
      pattern: "/api/tenants",
      async handler(rc) {
        if (rc.scope) {
          const denied = await rc.authorize("tenant:read", {
            type: "tenant",
            tenant: rc.scope.tenant,
          });
          if (denied) return denied;
          const tenant = await core.getTenant(rc.scope.tenant);
          return json(tenant ? [tenant] : []);
        }
        const all = await core.listTenants();
        if (!(await rc.authorize("tenant:read", { type: "tenant", tenant: "*" }))) {
          return json(all);
        }
        const visible: Tenant[] = [];
        for (const t of all) {
          if (!(await rc.authorize("tenant:read", { type: "tenant", tenant: t.key }))) {
            visible.push(t);
          }
        }
        return visible.length || all.length === 0
          ? json(visible)
          : error(403, "Forbidden", { action: "tenant:read" });
      },
    },
    {
      method: "GET",
      pattern: "/api/tenants/:tenant",
      async handler(rc) {
        const tenant = rc.params.tenant as string;
        const denied = await rc.authorize("tenant:read", { type: "tenant", tenant });
        if (denied) return denied;
        const found = await core.getTenant(tenant);
        return found ? json(found) : error(404, `Tenant "${tenant}" does not exist.`);
      },
    },
    {
      method: "PUT",
      pattern: "/api/tenants/:tenant",
      async handler(rc) {
        const tenant = rc.params.tenant as string;
        const denied = await rc.authorize("tenant:update", { type: "tenant", tenant });
        if (denied) return denied;
        const body = await readJsonObject<TenantPatch & Record<string, unknown>>(rc.request);
        const input: Tenant = {
          key: tenant,
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
        };
        return json(await core.upsertTenant(input, { actor: rc.actor }));
      },
    },
    {
      method: "DELETE",
      pattern: "/api/tenants/:tenant",
      async handler(rc) {
        const tenant = rc.params.tenant as string;
        const denied = await rc.authorize("tenant:delete", { type: "tenant", tenant });
        if (denied) return denied;
        await core.deleteTenant(tenant, { actor: rc.actor });
        return json({ ok: true });
      },
    },

    // ------------------------------------------------------------ domains
    {
      method: "GET",
      pattern: "/api/domains",
      async handler(rc) {
        const tenant = rc.scope?.tenant ?? rc.url.searchParams.get("tenant") ?? undefined;
        const denied = await rc.authorize("domain:read", {
          type: "domain",
          hostname: "*",
          ...(tenant !== undefined ? { tenant } : {}),
        });
        if (denied) return denied;
        return json(await core.listDomains(tenant !== undefined ? { tenant } : {}));
      },
    },
    {
      method: "POST",
      pattern: "/api/domains",
      async handler(rc) {
        const body = await readJsonObject<Domain>(rc.request);
        const denied = await rc.authorize("domain:create", {
          type: "domain",
          hostname: String(body.hostname ?? ""),
          ...(body.tenant ? { tenant: body.tenant } : {}),
        });
        if (denied) return denied;
        return json(await core.createDomain(body, { actor: rc.actor }), 201);
      },
    },
    {
      method: "GET",
      pattern: "/api/domains/:hostname",
      async handler(rc) {
        const hostname = (rc.params.hostname as string).toLowerCase();
        const domain = await core.getDomain(hostname);
        const denied = await rc.authorize("domain:read", {
          type: "domain",
          hostname,
          ...(domain?.tenant ? { tenant: domain.tenant } : {}),
        });
        if (denied) return denied;
        return domain ? json(domain) : error(404, `Domain "${hostname}" is not registered.`);
      },
    },
    {
      method: "PUT",
      pattern: "/api/domains/:hostname",
      async handler(rc) {
        const hostname = (rc.params.hostname as string).toLowerCase();
        const domain = await core.getDomain(hostname);
        const denied = await rc.authorize("domain:update", {
          type: "domain",
          hostname,
          ...(domain?.tenant ? { tenant: domain.tenant } : {}),
        });
        if (denied) return denied;
        const patch = await readJsonObject<Partial<Domain>>(rc.request);
        delete patch.hostname;
        delete patch.createdAt;
        delete patch.updatedAt;
        if (patch.tenant && patch.tenant !== domain?.tenant) {
          // Moving a domain to another tenant needs rights over the target too.
          const deniedTarget = await rc.authorize("domain:update", {
            type: "domain",
            hostname,
            tenant: patch.tenant,
          });
          if (deniedTarget) return deniedTarget;
        }
        return json(await core.updateDomain(hostname, patch, { actor: rc.actor }));
      },
    },
    {
      method: "DELETE",
      pattern: "/api/domains/:hostname",
      async handler(rc) {
        const hostname = (rc.params.hostname as string).toLowerCase();
        const domain = await core.getDomain(hostname);
        const denied = await rc.authorize("domain:delete", {
          type: "domain",
          hostname,
          ...(domain?.tenant ? { tenant: domain.tenant } : {}),
        });
        if (denied) return denied;
        const force = boolParam(rc.url.searchParams.get("force")) ?? false;
        await core.deleteDomain(hostname, { actor: rc.actor, force });
        return json({ ok: true });
      },
    },

    // ------------------------------------------------------------ links
    {
      method: "GET",
      pattern: "/api/tenants/:tenant/links",
      async handler(rc) {
        const tenant = rc.params.tenant as string;
        const denied = await rc.authorize("link:read", { type: "link", tenant });
        if (denied) return denied;
        return json(await linkPage(rc, tenant));
      },
    },
    {
      method: "POST",
      pattern: "/api/tenants/:tenant/links",
      async handler(rc) {
        const tenant = rc.params.tenant as string;
        const denied = await rc.authorize("link:create", { type: "link", tenant });
        if (denied) return denied;
        const body = await readJsonObject<CreateLinkInput>(rc.request);
        const link = await core.createLink({ ...body, tenant }, { actor: rc.actor });
        return json(publicLink(link), 201);
      },
    },
    {
      method: "GET",
      pattern: "/api/tenants/:tenant/links.csv",
      async handler(rc) {
        const tenant = rc.params.tenant as string;
        const denied = await rc.authorize("link:read", { type: "link", tenant });
        if (denied) return denied;
        const query = linkQuery(rc.url);
        delete query.limit;
        delete query.cursor;
        const links = await allLinks(tenant, rc.scope, {
          ...query,
          archived: query.archived ?? "all",
        });
        return new Response(linksToCsv(links.map(publicLink)), {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="${tenant.replace(/[^\w.-]/g, "_")}-links.csv"`,
          },
        });
      },
    },
    {
      method: "POST",
      pattern: "/api/tenants/:tenant/links/import",
      async handler(rc) {
        const tenant = rc.params.tenant as string;
        const denied = await rc.authorize("link:import", { type: "link", tenant });
        if (denied) return denied;
        const q = rc.url.searchParams;
        const contentType = rc.request.headers.get("content-type") ?? "";
        let rows: CreateLinkInput[];
        let dryRun = boolParam(q.get("dryRun"));
        let onConflict = q.get("onConflict") ?? undefined;
        if (/json/i.test(contentType)) {
          const body = await readJsonObject<{
            rows?: unknown;
            dryRun?: boolean;
            onConflict?: string;
          }>(rc.request);
          if (!Array.isArray(body.rows)) throw new BadRequestError("Expected { rows: [...] }");
          rows = body.rows as CreateLinkInput[];
          dryRun ??= body.dryRun;
          onConflict ??= body.onConflict;
        } else {
          const format = q.get("format") ?? "auto";
          if (format !== "auto" && !LINKS_CSV_FORMATS.includes(format as LinksCsvFormat)) {
            throw new BadRequestError(
              `format must be "auto" or one of ${LINKS_CSV_FORMATS.join(", ")}`,
            );
          }
          const domain = q.get("domain");
          const keepDomains = boolParam(q.get("keepDomains"));
          const tags = listParam(q.get("tags"));
          rows = parseLinksCsv(await rc.request.text(), {
            format: format as LinksCsvFormat | "auto",
            ...(domain ? { domain } : {}),
            ...(keepDomains !== undefined ? { keepDomains } : {}),
            ...(tags ? { tags } : {}),
          });
        }
        if (onConflict !== undefined && !["skip", "update", "error"].includes(onConflict)) {
          throw new BadRequestError('onConflict must be "skip", "update" or "error"');
        }
        if (rows.length > 10_000) throw new BadRequestError("At most 10000 rows per import");
        const result = await core.importLinks(tenant, rows, {
          actor: rc.actor,
          ...(dryRun ? { dryRun } : {}),
          ...(onConflict ? { onConflict: onConflict as ImportConflictPolicy } : {}),
        });
        return json({
          ...result,
          rows: result.rows.map((r) => (r.link ? { ...r, link: publicLink(r.link) } : r)),
        });
      },
    },
    {
      method: "GET",
      pattern: "/api/tenants/:tenant/links/:id",
      async handler(rc) {
        const tenant = rc.params.tenant as string;
        const id = rc.params.id as string;
        const denied = await rc.authorize("link:read", { type: "link", tenant, linkId: id });
        if (denied) return denied;
        const link = await core.getLink(tenant, id);
        if (!link) return error(404, `Link "${id}" does not exist in tenant "${tenant}".`);
        link.clicks = await core.getClickCount(tenant, id);
        return json(publicLink(link));
      },
    },
    {
      method: "PATCH",
      pattern: "/api/tenants/:tenant/links/:id",
      async handler(rc) {
        const tenant = rc.params.tenant as string;
        const id = rc.params.id as string;
        const denied = await rc.authorize("link:update", { type: "link", tenant, linkId: id });
        if (denied) return denied;
        const patch = await readJsonObject<UpdateLinkInput & { tenant?: string }>(rc.request);
        delete patch.tenant;
        return json(publicLink(await core.updateLink(tenant, id, patch, { actor: rc.actor })));
      },
    },
    {
      method: "DELETE",
      pattern: "/api/tenants/:tenant/links/:id",
      async handler(rc) {
        const tenant = rc.params.tenant as string;
        const id = rc.params.id as string;
        const denied = await rc.authorize("link:delete", { type: "link", tenant, linkId: id });
        if (denied) return denied;
        await core.deleteLink(tenant, id, { actor: rc.actor });
        return json({ ok: true });
      },
    },
    {
      method: "GET",
      pattern: "/api/tenants/:tenant/links/:id/qr.svg",
      async handler(rc) {
        const tenant = rc.params.tenant as string;
        const id = rc.params.id as string;
        const denied = await rc.authorize("link:read", { type: "link", tenant, linkId: id });
        if (denied) return denied;
        const link = await core.getLink(tenant, id);
        if (!link) return error(404, `Link "${id}" does not exist in tenant "${tenant}".`);
        const q = rc.url.searchParams;
        const ecc = q.get("ecc")?.toUpperCase();
        const fg = q.get("fg");
        const bg = q.get("bg");
        const svg = renderQrSvg(
          qrUrl(link, ctx.redirectBasePath ? { basePath: ctx.redirectBasePath } : {}),
          {
            ...(intParam(q.get("size")) !== undefined ? { size: intParam(q.get("size")) } : {}),
            ...(q.get("margin") !== null ? { margin: Number(q.get("margin")) } : {}),
            ...(fg ? { foreground: fg } : {}),
            ...(bg ? { background: bg } : {}),
            ...(ecc && ["L", "M", "Q", "H"].includes(ecc) ? { ecc: ecc as QrEcc } : {}),
          },
        );
        const headers: Record<string, string> = {
          "content-type": "image/svg+xml",
          "cache-control": "private, max-age=300",
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
        };
        if (boolParam(q.get("download"))) {
          headers["content-disposition"] =
            `attachment; filename="${link.slug.replace(/[^\w.-]/g, "_") || "qr"}.svg"`;
        }
        return new Response(svg, { headers });
      },
    },
    {
      method: "GET",
      pattern: "/api/tenants/:tenant/tags",
      async handler(rc) {
        const tenant = rc.params.tenant as string;
        const denied = await rc.authorize("link:read", { type: "link", tenant });
        if (denied) return denied;
        if (!rc.scope?.links) return json(await core.listTags(tenant));
        const counts = new Map<string, number>();
        for (const link of await allLinks(tenant, rc.scope, { archived: "all" })) {
          for (const t of link.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
        }
        return json(
          [...counts]
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
        );
      },
    },

    // ------------------------------------------------------------ customers + audit
    {
      method: "GET",
      pattern: "/api/tenants/:tenant/customers",
      async handler(rc) {
        const tenant = rc.params.tenant as string;
        const denied = await rc.authorize("customer:read", { type: "customer", tenant });
        if (denied) return denied;
        const customers = await core.listCustomers(tenant);
        const links = rc.scope?.links;
        return json(links ? customers.filter((c) => links.has(c.linkId)) : customers);
      },
    },
    {
      method: "GET",
      pattern: "/api/tenants/:tenant/audit",
      async handler(rc) {
        const tenant = rc.params.tenant as string;
        const denied = await rc.authorize("audit:read", { type: "audit", tenant });
        if (denied) return denied;
        const entries = await core.listAudit(tenant);
        const links = rc.scope?.links;
        return json(
          links ? entries.filter((e) => links.has(e.target.replace(/^link:/, ""))) : entries,
        );
      },
    },
    {
      method: "GET",
      pattern: "/api/audit",
      async handler(rc) {
        const denied = await rc.authorize("audit:read", { type: "audit" });
        if (denied) return denied;
        return json(await core.listAudit());
      },
    },

    // ------------------------------------------------------------ analytics
    {
      method: "GET",
      pattern: "/api/tenants/:tenant/analytics",
      async handler(rc) {
        const tenant = rc.params.tenant as string;
        const query = analyticsQuery(tenant, rc.url);
        const linkIds = clampLinkIds(rc.scope, query.linkIds);
        if (linkIds instanceof Response) return linkIds;
        const denied = await rc.authorize("analytics:read", {
          type: "analytics",
          tenant,
          ...(linkIds ? { linkIds } : {}),
        });
        if (denied) return denied;
        if (linkIds) query.linkIds = linkIds;
        return json(await core.queryAnalytics(query));
      },
    },
    {
      method: "GET",
      pattern: "/api/tenants/:tenant/events",
      async handler(rc) {
        const tenant = rc.params.tenant as string;
        const q = rc.url.searchParams;
        const linkIds = clampLinkIds(rc.scope, listParam(q.get("linkIds")));
        if (linkIds instanceof Response) return linkIds;
        const denied = await rc.authorize("analytics:read", {
          type: "analytics",
          tenant,
          ...(linkIds ? { linkIds } : {}),
        });
        if (denied) return denied;
        const sink = core.analytics;
        if (!sink.events) {
          throw new NotConfiguredError("The analytics sink does not expose raw events.");
        }
        const types = listParam(q.get("types"));
        const bad = types?.filter((t) => !["click", "lead", "sale"].includes(t));
        if (bad?.length) throw new BadRequestError('types must be "click", "lead" or "sale"');
        const before = q.get("before");
        const limit = intParam(q.get("limit"));
        const includeBots = boolParam(q.get("includeBots"));
        const query: EventsQuery = {
          tenant,
          ...(linkIds ? { linkIds } : {}),
          ...(types ? { types: types as AnalyticsEvent["type"][] } : {}),
          ...(before ? { before } : {}),
          ...(limit !== undefined ? { limit: Math.min(limit, 1000) } : {}),
          ...(includeBots !== undefined ? { includeBots } : {}),
        };
        return json(await sink.events(query));
      },
    },

    // ------------------------------------------------------------ conversions
    {
      method: "POST",
      pattern: "/api/track/lead",
      async handler(rc) {
        const body = await readJsonObject<TrackLeadInput>(rc.request);
        const tenant = body.tenant ?? rc.scope?.tenant ?? DEFAULT_TENANT;
        const denied = await rc.authorize("conversion:track", { type: "conversion", tenant });
        if (denied) return denied;
        const result = await core.trackLead({ ...body, tenant });
        return json(result ? { attributed: true, ...result } : { attributed: false });
      },
    },
    {
      method: "POST",
      pattern: "/api/track/sale",
      async handler(rc) {
        const body = await readJsonObject<TrackSaleInput>(rc.request);
        const tenant = body.tenant ?? rc.scope?.tenant ?? DEFAULT_TENANT;
        const denied = await rc.authorize("conversion:track", { type: "conversion", tenant });
        if (denied) return denied;
        const result = await core.trackSale({ ...body, tenant });
        return json(result ? { attributed: true, ...result } : { attributed: false });
      },
    },

    // ------------------------------------------------------------ viewer tokens
    {
      method: "POST",
      pattern: "/api/tenants/:tenant/viewer-tokens",
      async handler(rc) {
        const tenant = rc.params.tenant as string;
        const denied = await rc.authorize("viewer-token:create", { type: "viewer-token", tenant });
        if (denied) return denied;
        if (!ctx.portal) {
          throw new NotConfiguredError("Viewer tokens are not enabled (set `portal.secret`).");
        }
        const body = await readJsonObject<{
          links?: unknown;
          allow?: unknown;
          expiresIn?: unknown;
        }>(rc.request);
        const issues: { path: string; message: string }[] = [];
        const isStrings = (v: unknown): v is string[] =>
          Array.isArray(v) && v.every((x) => typeof x === "string");
        if (body.links !== undefined && !isStrings(body.links)) {
          issues.push({ path: "links", message: "must be an array of link ids" });
        }
        if (body.allow !== undefined) {
          if (!isStrings(body.allow)) {
            issues.push({ path: "allow", message: "must be an array of actions" });
          } else {
            const bad = body.allow.filter(
              (a) => !VIEWER_GRANTABLE_ACTIONS.includes(a as LinksAction),
            );
            if (bad.length) {
              issues.push({
                path: "allow",
                message: `cannot grant ${bad.join(", ")} (grantable: ${VIEWER_GRANTABLE_ACTIONS.join(", ")})`,
              });
            }
          }
        }
        let expiresInMs = 86_400_000;
        if (body.expiresIn !== undefined) {
          try {
            expiresInMs = durationToMs(body.expiresIn as LinksDuration);
            if (expiresInMs <= 0) throw new Error("non-positive");
          } catch {
            issues.push({ path: "expiresIn", message: 'must be a duration like "1h" or "7d"' });
          }
        }
        if (issues.length) throw new ValidationError(issues);
        const links = body.links as string[] | undefined;
        const allow = (body.allow as LinksAction[] | undefined) ??
          ctx.portal.allow ?? [...DEFAULT_VIEWER_ACTIONS];
        // A minter can only delegate what it holds itself.
        for (const action of allow) {
          const deniedGrant = await rc.authorize(action, tenantResource(action, tenant));
          if (deniedGrant) return deniedGrant;
        }
        const token = await createViewerToken(ctx.portal.secret, {
          tenant,
          ...(links ? { links } : {}),
          ...(body.allow !== undefined ? { allow } : {}),
          expiresIn: expiresInMs,
        });
        return json(
          {
            token,
            tenant,
            ...(links ? { links } : {}),
            allow,
            expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
          },
          201,
        );
      },
    },
  ];

  async function authenticate(
    request: Request,
  ): Promise<{ principal: Principal | null; scope: ViewerScope | null }> {
    const header = request.headers.get("authorization");
    if (ctx.portal && header?.startsWith(`Bearer ${VIEWER_TOKEN_PREFIX}`)) {
      // A presented viewer token short-circuits the host's providers: valid →
      // viewer principal; invalid/expired → 401 (thrown), never a fallback.
      const claims = await verifyViewerToken(ctx.portal.secret, header.slice("Bearer ".length));
      const granted = claims.allow ?? ctx.portal.allow ?? DEFAULT_VIEWER_ACTIONS;
      const scope: ViewerScope = {
        tenant: claims.tenant,
        links: claims.links ? new Set(claims.links) : null,
        allow: new Set(granted.filter((a) => VIEWER_GRANTABLE_ACTIONS.includes(a))),
        exp: claims.exp,
      };
      return {
        principal: {
          id: `viewer:${claims.tenant}`,
          roles: ["viewer"],
          metadata: { viewer: true, tenant: claims.tenant, links: claims.links ?? null },
        },
        scope,
      };
    }
    return { principal: await ctx.auth.authenticate(request), scope: null };
  }

  return async function handleApiRequest(request, path) {
    const isApi =
      path === "/config" ||
      path === "/healthcheck" ||
      path === "/openapi.json" ||
      path.startsWith("/api/");
    if (!isApi) return null;
    const method = request.method.toUpperCase();

    if (path === "/healthcheck" || path === "/api/healthcheck") {
      return json({ status: "ok", version: VERSION });
    }
    // Public OpenAPI document (no auth) — for docs tooling and host-app merging.
    if (path === "/api/openapi.json" || path === "/openapi.json") {
      return json(buildOpenApiDocument({ basePath: ctx.basePath, title: ctx.title }));
    }

    let principal: Principal | null;
    let scope: ViewerScope | null;
    try {
      ({ principal, scope } = await authenticate(request));
    } catch (err) {
      // A throwing auth provider is a backend failure → 500; a bad viewer token → 401.
      return mapError(err);
    }

    // Public bootstrap config: whether to show a login, the widget chrome, etc.
    if (path === "/config" || path === "/api/config") {
      return json({
        title: ctx.title,
        ...(ctx.logoUrl !== undefined ? { logoUrl: ctx.logoUrl } : {}),
        basePath: ctx.basePath,
        readonly: isReadonly(),
        authenticated: principal !== null,
        principal: principal
          ? {
              id: principal.id,
              email: principal.email,
              name: principal.name,
              roles: principal.roles,
            }
          : null,
        viewer: scope !== null,
        ...(scope
          ? {
              tenant: scope.tenant,
              ...(scope.links ? { links: [...scope.links] } : {}),
              allow: [...scope.allow],
              expiresAt: new Date(scope.exp).toISOString(),
            }
          : {}),
        viewerTokens: ctx.portal !== undefined,
        capabilities: core.analytics.capabilities,
        version: VERSION,
      });
    }

    if (principal === null) {
      const challenge = ctx.auth.challenge?.(request);
      return challenge ?? error(401, "Unauthorized");
    }
    const who = principal;

    const authorize = async (
      action: LinksAction,
      resource: LinksResource,
    ): Promise<Response | null> => {
      if (isReadonly() && isMutatingAction(action)) {
        return error(403, "Cannot modify: @xtandard/links is in readonly mode.", {
          code: "READONLY",
          action,
        });
      }
      if (scope) {
        // The host's authorization provider is NOT consulted for viewers — the
        // token's scope is the whole grant.
        const forbidden = error(403, "Forbidden", { action });
        if (!scope.allow.has(action)) return forbidden;
        if (resource.type === "domain") {
          // Shared domains (no tenant) are readable by every tenant's viewers.
          if (resource.tenant !== undefined && resource.tenant !== scope.tenant) return forbidden;
          return action === "domain:read" ? null : forbidden;
        }
        if (resource.tenant !== scope.tenant) return forbidden;
        if (scope.links) {
          if (resource.type === "link") {
            if (action === "link:create" || action === "link:import") return forbidden;
            if (resource.linkId !== undefined && !scope.links.has(resource.linkId)) {
              return forbidden;
            }
          }
          if (resource.type === "analytics") {
            if (!resource.linkIds || resource.linkIds.some((id) => !scope.links?.has(id))) {
              return forbidden;
            }
          }
        }
        return null;
      }
      const ok = await ctx.authorization.authorize({ principal: who, action, resource, request });
      return ok ? null : error(403, "Forbidden", { action });
    };

    const url = new URL(request.url);
    let methodMismatch = false;
    try {
      for (const route of routes) {
        const params = match(route.pattern, path);
        if (!params) continue;
        if (route.method !== method) {
          methodMismatch = true;
          continue;
        }
        return await route.handler({
          request,
          url,
          params,
          principal: who,
          scope,
          actor: actorFor(who),
          authorize,
        });
      }
    } catch (err) {
      return mapError(err);
    }
    return methodMismatch ? error(405, "Method Not Allowed") : error(404, "Not found");
  };
}

/**
 * Cross-bundle error detection: `instanceof` first, `err.name` fallback. An
 * error thrown from a separate subpath bundle carries its own copy of the
 * class, so `instanceof` alone would mis-map it to 500.
 */
function isNamed(err: unknown, ctor: new (...args: never[]) => Error, name: string): boolean {
  return err instanceof ctor || (err instanceof Error && err.name === name);
}

/** A hook denial's status (by name, see {@link isNamed}), or `null`. */
function hookDeniedStatus(err: unknown): number | null {
  if (err instanceof HookDeniedError) return err.status;
  if (err instanceof Error && err.name === "HookDeniedError") {
    const status = (err as { status?: unknown }).status;
    return typeof status === "number" ? status : 403;
  }
  return null;
}

/** Map domain errors to HTTP responses. */
export function mapError(err: unknown): Response {
  if (isNamed(err, ReadonlyError, "ReadonlyError")) {
    return error(403, (err as Error).message, { code: "READONLY" });
  }
  const denied = hookDeniedStatus(err);
  if (denied !== null) return error(denied, (err as Error).message, { code: "HOOK_DENIED" });
  if (isNamed(err, ViewerTokenError, "ViewerTokenError")) {
    return error(401, (err as Error).message, { code: "VIEWER_TOKEN" });
  }
  if (isNamed(err, NotFoundError, "NotFoundError")) {
    return error(404, (err as Error).message, { code: "NOT_FOUND" });
  }
  if (isNamed(err, ConflictError, "ConflictError")) {
    return error(409, (err as Error).message, { code: "CONFLICT" });
  }
  if (isNamed(err, ValidationError, "ValidationError")) {
    const errors = (err as { errors?: unknown }).errors;
    return error(400, (err as Error).message, {
      code: "VALIDATION",
      errors: Array.isArray(errors) ? errors : [],
    });
  }
  if (isNamed(err, UnsupportedQueryError, "UnsupportedQueryError")) {
    return error(400, (err as Error).message, { code: "UNSUPPORTED_QUERY" });
  }
  if (isNamed(err, CsvParseError, "CsvParseError")) {
    return error(400, (err as Error).message, { code: "BAD_CSV" });
  }
  if (err instanceof BadRequestError) {
    return error(400, err.message, { code: "BAD_REQUEST" });
  }
  if (err instanceof NotConfiguredError) {
    return error(501, err.message, { code: "NOT_CONFIGURED" });
  }
  if (err instanceof SyntaxError) return error(400, "Invalid JSON body", { code: "BAD_REQUEST" });
  const message = err instanceof Error ? err.message : "Internal error";
  return error(500, message);
}
