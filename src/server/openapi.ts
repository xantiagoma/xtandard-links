/**
 * OpenAPI 3.1 description of the admin JSON API.
 *
 * Exposed two ways (mirrors `@xtandard/webhooks` / `@xtandard/flags`):
 *  - served at `GET {basePath}/api/openapi.json` for standalone tools (Scalar,
 *    Swagger UI, Postman, codegen);
 *  - returned by `createFetchHandler(...).openapi()` so you can MERGE it into
 *    your host app's OpenAPI document.
 *
 * Hand-authored — no generation dependency. `docs/HTTP_API.md` is the prose
 * companion.
 *
 * @module
 */

import { ANALYTICS_DIMENSIONS } from "../analytics/contract.ts";
import { VERSION } from "../version.ts";

/** Options for {@link buildOpenApiDocument}. */
export interface OpenApiOptions {
  /** Mount prefix used in the `servers` url (e.g. `"/links"`). */
  basePath?: string;
  /** Document title. */
  title?: string;
  /** Document version (defaults to the package version). */
  version?: string;
}

const str = { type: "string" } as const;
const int = { type: "integer" } as const;
const bool = { type: "boolean" } as const;
const date = { type: "string", format: "date-time" } as const;
const strings = { type: "array", items: str } as const;
const anyObject = { type: "object", additionalProperties: true } as const;

const ACTIONS = [
  "tenant:read",
  "tenant:update",
  "tenant:delete",
  "domain:read",
  "domain:create",
  "domain:update",
  "domain:delete",
  "link:read",
  "link:create",
  "link:update",
  "link:delete",
  "link:import",
  "analytics:read",
  "customer:read",
  "audit:read",
  "conversion:track",
  "viewer-token:create",
];

const metrics = {
  clicks: int,
  botClicks: int,
  leads: int,
  sales: int,
  saleAmount: { type: "integer", description: "Minor units (cents)." },
  uniques: int,
};

const linkFields = {
  domain: { type: "string", description: "Hostname; default: the tenant's default domain." },
  slug: { type: "string", description: "Default: generated." },
  url: { type: "string", description: "Destination (http(s) or an app scheme)." },
  title: { type: ["string", "null"] },
  description: { type: ["string", "null"] },
  tags: strings,
  externalId: { type: ["string", "null"] },
  expiresAt: { type: ["string", "null"], format: "date-time" },
  expiredUrl: { type: ["string", "null"] },
  maxClicks: { type: ["integer", "null"] },
  password: { type: ["string", "null"], description: "Write-only; stored as a hash." },
  utm: { $ref: "#/components/schemas/Utm" },
  preview: {
    type: ["object", "null"],
    properties: { title: str, description: str, image: str },
  },
  rules: { type: "array", items: { $ref: "#/components/schemas/LinkRule" } },
  ios: { type: ["string", "null"] },
  android: { type: ["string", "null"] },
  deepLink: { type: ["object", "null"], properties: { path: str, deferred: bool } },
  redirectStatus: { type: ["integer", "null"], enum: [301, 302, 307, 308, null] },
  trackConversions: bool,
  passQuery: bool,
  indexable: bool,
  disabled: bool,
  archived: bool,
  metadata: { type: ["object", "null"], additionalProperties: true },
};

const schemas = {
  Tenant: {
    type: "object",
    required: ["key"],
    properties: {
      key: { type: "string", pattern: "^[a-zA-Z0-9._-]+$" },
      name: str,
      metadata: anyObject,
      createdAt: date,
      updatedAt: date,
    },
  },
  Domain: {
    type: "object",
    required: ["hostname"],
    properties: {
      hostname: str,
      tenant: { type: "string", description: "Owning tenant; unset = shared by every tenant." },
      rootUrl: str,
      notFoundUrl: str,
      caseSensitive: bool,
      slugLength: int,
      isDefault: bool,
      apps: {
        type: "object",
        properties: {
          ios: { type: "object", properties: { appIds: strings, paths: strings } },
          android: {
            type: "array",
            items: {
              type: "object",
              properties: { packageName: str, sha256CertFingerprints: strings },
            },
          },
        },
      },
      metadata: anyObject,
      createdAt: date,
      updatedAt: date,
    },
  },
  Utm: {
    type: ["object", "null"],
    properties: { source: str, medium: str, campaign: str, term: str, content: str },
  },
  LinkRule: {
    type: "object",
    required: ["when"],
    properties: {
      id: str,
      name: str,
      when: { type: "array", items: anyObject },
      url: str,
      variants: {
        type: "array",
        items: {
          type: "object",
          required: ["url", "weight"],
          properties: { id: str, url: str, weight: { type: "number" } },
        },
      },
    },
  },
  Link: {
    type: "object",
    required: ["id", "tenant", "domain", "slug", "url", "tags", "rules", "hasPassword"],
    description: "A link as served by the API: the password hash becomes `hasPassword`.",
    properties: {
      id: str,
      tenant: str,
      ...linkFields,
      hasPassword: bool,
      clicks: { type: "integer", description: "Approximate non-bot click count." },
      createdAt: date,
      updatedAt: date,
      createdBy: str,
    },
  },
  CreateLink: {
    type: "object",
    required: ["url"],
    properties: linkFields,
  },
  UpdateLink: {
    type: "object",
    description: "Any subset of link fields; `null` clears a field.",
    properties: linkFields,
  },
  LinkPage: {
    type: "object",
    required: ["links", "total"],
    properties: {
      links: { type: "array", items: { $ref: "#/components/schemas/Link" } },
      total: int,
      nextCursor: str,
    },
  },
  ImportResult: {
    type: "object",
    required: ["created", "updated", "skipped", "errors", "rows"],
    properties: {
      created: int,
      updated: int,
      skipped: int,
      errors: int,
      rows: {
        type: "array",
        items: {
          type: "object",
          required: ["index", "status"],
          properties: {
            index: int,
            status: { type: "string", enum: ["created", "updated", "skipped", "error"] },
            link: { $ref: "#/components/schemas/Link" },
            error: str,
          },
        },
      },
    },
  },
  Metrics: { type: "object", properties: metrics },
  AnalyticsResult: {
    type: "object",
    required: ["totals"],
    properties: {
      totals: { $ref: "#/components/schemas/Metrics" },
      timeseries: {
        type: "array",
        items: { type: "object", properties: { at: date, ...metrics } },
      },
      breakdown: {
        type: "array",
        items: { type: "object", properties: { key: str, ...metrics } },
      },
    },
  },
  AnalyticsEvent: {
    type: "object",
    required: ["type", "id", "at", "tenant", "linkId"],
    description:
      "A click, lead or sale event (see `ClickEvent`/`LeadEvent`/`SaleEvent` in the schema module).",
    properties: {
      type: { type: "string", enum: ["click", "lead", "sale"] },
      id: str,
      at: date,
      tenant: str,
      linkId: str,
      domain: str,
      slug: str,
    },
    additionalProperties: true,
  },
  Customer: {
    type: "object",
    required: ["id", "tenant", "clickId", "linkId", "firstSeenAt"],
    properties: {
      id: str,
      tenant: str,
      clickId: str,
      linkId: str,
      name: str,
      email: str,
      firstSeenAt: date,
      metadata: anyObject,
    },
  },
  AuditEntry: {
    type: "object",
    required: ["at", "action", "target"],
    properties: {
      at: date,
      action: str,
      actor: { type: ["object", "null"], properties: { id: str, email: str, name: str } },
      target: str,
      details: anyObject,
    },
  },
  TrackLead: {
    type: "object",
    required: ["customerId"],
    properties: {
      tenant: str,
      clickId: str,
      customerId: str,
      name: str,
      customerName: str,
      customerEmail: str,
      metadata: anyObject,
      at: date,
    },
  },
  TrackSale: {
    type: "object",
    required: ["customerId", "amount"],
    properties: {
      tenant: str,
      customerId: str,
      amount: { type: "integer", description: "Minor units (cents)." },
      currency: str,
      invoiceId: str,
      name: str,
      clickId: str,
      metadata: anyObject,
      at: date,
    },
  },
  TrackResult: {
    type: "object",
    required: ["attributed"],
    properties: {
      attributed: { type: "boolean", description: "False when the click/customer is unknown." },
      event: { $ref: "#/components/schemas/AnalyticsEvent" },
      customer: { $ref: "#/components/schemas/Customer" },
      duplicate: bool,
    },
  },
  ViewerToken: {
    type: "object",
    required: ["token", "tenant", "allow", "expiresAt"],
    properties: {
      token: { type: "string", description: '"lvt_…" bearer token.' },
      tenant: str,
      links: strings,
      allow: { type: "array", items: { type: "string", enum: ACTIONS } },
      expiresAt: date,
    },
  },
  Config: {
    type: "object",
    properties: {
      title: str,
      logoUrl: str,
      basePath: str,
      readonly: bool,
      authenticated: bool,
      principal: { type: ["object", "null"] },
      viewer: { type: "boolean", description: "True when the request carried a viewer token." },
      tenant: { type: "string", description: "The viewer's tenant (viewer only)." },
      links: { ...strings, description: "The viewer's link set (viewer only, when scoped)." },
      allow: { ...strings, description: "The viewer's actions (viewer only)." },
      expiresAt: date,
      viewerTokens: { type: "boolean", description: "Viewer tokens are enabled." },
      capabilities: {
        type: "object",
        properties: {
          crossFilter: bool,
          uniques: bool,
          events: bool,
          intervals: { type: "array", items: { type: "string", enum: ["hour", "day"] } },
        },
      },
      version: str,
    },
  },
  Ok: { type: "object", properties: { ok: { const: true } } },
  Error: {
    type: "object",
    required: ["error"],
    properties: {
      error: str,
      code: str,
      action: str,
      errors: {
        type: "array",
        items: { type: "object", properties: { path: str, message: str } },
      },
    },
  },
} as const;

const TENANT = { name: "tenant", in: "path", required: true, schema: str } as const;
const ID = { name: "id", in: "path", required: true, schema: str } as const;
const HOSTNAME = { name: "hostname", in: "path", required: true, schema: str } as const;
const q = (name: string, schema: object, description?: string) => ({
  name,
  in: "query",
  required: false,
  schema,
  ...(description ? { description } : {}),
});

const jsonBody = (schema: object, required = true) => ({
  required,
  content: { "application/json": { schema } },
});
const jsonRes = (description: string, schema: object) => ({
  description,
  content: { "application/json": { schema } },
});
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const arrayOf = (name: string) => ({ type: "array", items: ref(name) });
const errorRes = (description: string) => jsonRes(description, ref("Error"));
const ok = (description = "Done") => jsonRes(description, ref("Ok"));

const STANDARD_ERRORS = {
  "401": errorRes("Unauthenticated, or an invalid/expired viewer token"),
  "403": errorRes("Forbidden (authorization, viewer scope, readonly mode, or a hook veto)"),
};

/** Build the OpenAPI 3.1 document for the admin API. */
export function buildOpenApiDocument(options: OpenApiOptions = {}): Record<string, unknown> {
  const basePath = options.basePath ?? "";
  const tag = (name: string, op: Record<string, unknown>) => ({
    tags: [name],
    ...op,
    responses: { ...STANDARD_ERRORS, ...(op.responses as object) },
  });
  return {
    openapi: "3.1.0",
    info: {
      title: options.title ?? "@xtandard/links",
      version: options.version ?? VERSION,
      description:
        "Admin API for @xtandard/links: tenants, domains, links, bulk import/export, QR codes, analytics, conversions and viewer tokens. Authenticate with the host's provider, or with an `lvt_…` viewer token (tenant-scoped, read-mostly).",
    },
    servers: [{ url: basePath || "/" }],
    security: [{ basicAuth: [] }, { bearerAuth: [] }],
    tags: [
      { name: "meta" },
      { name: "tenants" },
      { name: "domains" },
      { name: "links" },
      { name: "analytics" },
      { name: "conversions" },
      { name: "viewer-tokens" },
      { name: "audit" },
    ],
    paths: {
      "/config": {
        get: {
          tags: ["meta"],
          summary: "Bootstrap config (public; reflects the presented credentials)",
          security: [],
          responses: { "200": jsonRes("Config", ref("Config")) },
        },
      },
      "/healthcheck": {
        get: {
          tags: ["meta"],
          summary: "Liveness probe (public)",
          security: [],
          responses: { "200": jsonRes("OK", { type: "object", properties: { status: str } }) },
        },
      },
      "/api/openapi.json": {
        get: {
          tags: ["meta"],
          summary: "This document (public)",
          security: [],
          responses: { "200": jsonRes("OpenAPI document", anyObject) },
        },
      },
      "/api/tenants": {
        get: tag("tenants", {
          summary: "List tenants (viewers: their own)",
          responses: { "200": jsonRes("Tenants", arrayOf("Tenant")) },
        }),
      },
      "/api/tenants/{tenant}": {
        parameters: [TENANT],
        get: tag("tenants", {
          summary: "Get a tenant",
          responses: { "200": jsonRes("Tenant", ref("Tenant")), "404": errorRes("Not found") },
        }),
        put: tag("tenants", {
          summary: "Create or update a tenant",
          requestBody: jsonBody({ type: "object", properties: { name: str, metadata: anyObject } }),
          responses: {
            "200": jsonRes("Tenant", ref("Tenant")),
            "400": errorRes("Validation failed"),
          },
        }),
        delete: tag("tenants", {
          summary: "Delete a tenant, its links and its own domains",
          responses: { "200": ok(), "404": errorRes("Not found") },
        }),
      },
      "/api/domains": {
        get: tag("domains", {
          summary: "List domains (with `tenant`: shared + that tenant's own)",
          parameters: [q("tenant", str)],
          responses: { "200": jsonRes("Domains", arrayOf("Domain")) },
        }),
        post: tag("domains", {
          summary: "Register a domain",
          requestBody: jsonBody(ref("Domain")),
          responses: {
            "201": jsonRes("Created", ref("Domain")),
            "400": errorRes("Validation failed"),
            "409": errorRes("Already registered"),
          },
        }),
      },
      "/api/domains/{hostname}": {
        parameters: [HOSTNAME],
        get: tag("domains", {
          summary: "Get a domain",
          responses: { "200": jsonRes("Domain", ref("Domain")), "404": errorRes("Not found") },
        }),
        put: tag("domains", {
          summary: "Update a domain (`null` clears a field)",
          requestBody: jsonBody(ref("Domain")),
          responses: {
            "200": jsonRes("Domain", ref("Domain")),
            "400": errorRes("Validation failed"),
            "404": errorRes("Not found"),
            "409": errorRes("caseSensitive cannot change while the domain has links"),
          },
        }),
        delete: tag("domains", {
          summary: "Remove a domain",
          parameters: [q("force", bool, "Also delete the domain's links.")],
          responses: {
            "200": ok(),
            "404": errorRes("Not found"),
            "409": errorRes("The domain still has links (pass force=true)"),
          },
        }),
      },
      "/api/tenants/{tenant}/links": {
        parameters: [TENANT],
        get: tag("links", {
          summary: "List links (newest first, cursor-paged)",
          parameters: [
            q("search", str, "Case-insensitive match on slug, URL, title, tags and domain."),
            q("tag", str),
            q("domain", str),
            q("archived", { type: "string", enum: ["true", "false", "all"] }, "Default false."),
            q("limit", int, "Default 50, max 500."),
            q("cursor", str, "The previous page's nextCursor."),
          ],
          responses: { "200": jsonRes("A page of links", ref("LinkPage")) },
        }),
        post: tag("links", {
          summary: "Create a link",
          requestBody: jsonBody(ref("CreateLink")),
          responses: {
            "201": jsonRes("Created", ref("Link")),
            "400": errorRes("Validation failed"),
            "404": errorRes("Domain not registered"),
            "409": errorRes("Slug or external id taken"),
          },
        }),
      },
      "/api/tenants/{tenant}/links.csv": {
        parameters: [TENANT],
        get: tag("links", {
          summary: "Export links as CSV (native format; all archive states by default)",
          parameters: [
            q("search", str),
            q("tag", str),
            q("domain", str),
            q("archived", { type: "string", enum: ["true", "false", "all"] }),
          ],
          responses: {
            "200": { description: "CSV", content: { "text/csv": { schema: str } } },
          },
        }),
      },
      "/api/tenants/{tenant}/links/import": {
        parameters: [TENANT],
        post: tag("links", {
          summary: "Bulk import links (JSON rows or a CSV file)",
          parameters: [
            q(
              "format",
              { type: "string", enum: ["auto", "native", "bitly", "dub", "shlink", "kutt"] },
              "CSV only. Default auto.",
            ),
            q("dryRun", bool),
            q("onConflict", { type: "string", enum: ["skip", "update", "error"] }, "Default skip."),
            q("domain", str, "CSV only: put every row on this domain."),
            q("keepDomains", bool, "CSV only: keep each row's source domain."),
            q("tags", str, "CSV only: comma-separated tags added to every row."),
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["rows"],
                  properties: {
                    rows: { type: "array", items: ref("CreateLink") },
                    dryRun: bool,
                    onConflict: { type: "string", enum: ["skip", "update", "error"] },
                  },
                },
              },
              "text/csv": { schema: str },
            },
          },
          responses: {
            "200": jsonRes("Per-row outcome", ref("ImportResult")),
            "400": errorRes("Malformed body or CSV"),
          },
        }),
      },
      "/api/tenants/{tenant}/links/{id}": {
        parameters: [TENANT, ID],
        get: tag("links", {
          summary: "Get a link",
          responses: { "200": jsonRes("Link", ref("Link")), "404": errorRes("Not found") },
        }),
        patch: tag("links", {
          summary: "Update a link",
          requestBody: jsonBody(ref("UpdateLink")),
          responses: {
            "200": jsonRes("Link", ref("Link")),
            "400": errorRes("Validation failed"),
            "404": errorRes("Not found"),
            "409": errorRes("Slug or external id taken"),
          },
        }),
        delete: tag("links", {
          summary: "Delete a link",
          responses: { "200": ok(), "404": errorRes("Not found") },
        }),
      },
      "/api/tenants/{tenant}/links/{id}/qr.svg": {
        parameters: [TENANT, ID],
        get: tag("links", {
          summary: "QR code for the link's short URL (+ ?qr=1) as SVG",
          parameters: [
            q("size", int, "Pixels, default 256."),
            q("margin", int, "Quiet zone in modules, default 2."),
            q("fg", str, "Module colour (hex without #, a name, rgb()/hsl())."),
            q("bg", str, 'Background colour, or "transparent".'),
            q("ecc", { type: "string", enum: ["L", "M", "Q", "H"] }),
            q("download", bool, "Send as an attachment."),
          ],
          responses: {
            "200": { description: "SVG", content: { "image/svg+xml": { schema: str } } },
            "404": errorRes("Not found"),
          },
        }),
      },
      "/api/tenants/{tenant}/tags": {
        parameters: [TENANT],
        get: tag("links", {
          summary: "Tags in use, by count",
          responses: {
            "200": jsonRes("Tags", {
              type: "array",
              items: { type: "object", properties: { tag: str, count: int } },
            }),
          },
        }),
      },
      "/api/tenants/{tenant}/customers": {
        parameters: [TENANT],
        get: tag("conversions", {
          summary: "Customers attributed to clicks (newest first)",
          responses: { "200": jsonRes("Customers", arrayOf("Customer")) },
        }),
      },
      "/api/tenants/{tenant}/analytics": {
        parameters: [TENANT],
        get: tag("analytics", {
          summary: "Aggregate clicks, leads and sales",
          parameters: [
            q("from", date, "Inclusive; default `to` − 30 days."),
            q("to", date, "Exclusive; default now."),
            q("interval", { type: "string", enum: ["hour", "day", "none"] }, "Default day."),
            q("groupBy", { type: "string", enum: [...ANALYTICS_DIMENSIONS] }),
            q("linkIds", str, "Comma-separated link ids."),
            q("limit", int, "Breakdown rows, default 10."),
            {
              name: "filter",
              in: "query",
              required: false,
              style: "deepObject",
              explode: true,
              schema: {
                type: "object",
                additionalProperties: str,
                propertyNames: { enum: [...ANALYTICS_DIMENSIONS] },
              },
              description: "`filter[country]=US,DE` — equality filters (comma = OR).",
            },
          ],
          responses: {
            "200": jsonRes("Result", ref("AnalyticsResult")),
            "400": errorRes("Bad query, or one the analytics sink cannot answer"),
          },
        }),
      },
      "/api/tenants/{tenant}/events": {
        parameters: [TENANT],
        get: tag("analytics", {
          summary: "Recent raw events (newest first)",
          parameters: [
            q("linkIds", str),
            q("types", str, "Comma-separated: click, lead, sale."),
            q("before", date),
            q("limit", int, "Default 50, max 1000."),
            q("includeBots", bool),
          ],
          responses: {
            "200": jsonRes("Events", arrayOf("AnalyticsEvent")),
            "501": errorRes("The analytics sink has no raw events"),
          },
        }),
      },
      "/api/track/lead": {
        post: tag("conversions", {
          summary: "Attribute a lead (signup) to a click",
          requestBody: jsonBody(ref("TrackLead")),
          responses: {
            "200": jsonRes("Result", ref("TrackResult")),
            "400": errorRes("Validation failed"),
          },
        }),
      },
      "/api/track/sale": {
        post: tag("conversions", {
          summary: "Attribute a sale to a customer's click (idempotent on invoiceId)",
          requestBody: jsonBody(ref("TrackSale")),
          responses: {
            "200": jsonRes("Result", ref("TrackResult")),
            "400": errorRes("Validation failed"),
          },
        }),
      },
      "/api/tenants/{tenant}/viewer-tokens": {
        parameters: [TENANT],
        post: tag("viewer-tokens", {
          summary: "Mint an analytics viewer token for the tenant",
          requestBody: jsonBody(
            {
              type: "object",
              properties: {
                links: strings,
                allow: { type: "array", items: { type: "string", enum: ACTIONS } },
                expiresIn: { type: ["string", "integer"], description: 'e.g. "1h", "7d".' },
              },
            },
            false,
          ),
          responses: {
            "201": jsonRes("Token", ref("ViewerToken")),
            "400": errorRes("Validation failed"),
            "501": errorRes("Viewer tokens are not enabled"),
          },
        }),
      },
      "/api/tenants/{tenant}/audit": {
        parameters: [TENANT],
        get: tag("audit", {
          summary: "Tenant audit log (newest first)",
          responses: { "200": jsonRes("Audit", arrayOf("AuditEntry")) },
        }),
      },
      "/api/audit": {
        get: tag("audit", {
          summary: "Global audit log (tenant deletions, shared domains)",
          responses: { "200": jsonRes("Audit", arrayOf("AuditEntry")) },
        }),
      },
    },
    components: {
      schemas,
      securitySchemes: {
        basicAuth: { type: "http", scheme: "basic" },
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Viewer tokens (lvt_…) or host-issued bearer credentials.",
        },
      },
    },
  };
}
