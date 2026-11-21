# HTTP API

The admin panel's JSON API (`createFetchHandler`, every adapter's `linksPanel`). All paths are
relative to the panel's `basePath` (e.g. `/links/api/tenants`). The machine-readable version is the
OpenAPI 3.1 document at `GET /api/openapi.json` (also `panel.openapi()`).

## Conventions

- **Auth.** Every `/api/*` route runs the panel's `auth` provider, then `authorization` (see
  `docs/AUTH.md`, `docs/AUTHORIZATION.md`). With `portal` configured,
  `Authorization: Bearer lvt_…` authenticates an analytics **viewer** instead, force-scoped to its
  tenant / links / actions. The action each route checks is listed below.
- **Bodies** are JSON (`content-type: application/json`) unless noted. A body that is not a JSON
  object is a `400`.
- **Links in responses** never contain the password hash: `password` is replaced by
  `hasPassword: boolean`. Lists also carry `clicks` (approximate, non-bot).
- **Dates** are ISO-8601 strings (UTC).
- **Errors** are `{ error: string, code?: string, action?: string, errors?: { path, message }[] }`:

| Status | `code`              | When                                                                               |
| ------ | ------------------- | ---------------------------------------------------------------------------------- |
| 400    | `VALIDATION`        | Invalid input; `errors[]` lists `{ path, message }` (e.g. `link.url`)              |
| 400    | `BAD_REQUEST`       | Malformed JSON, a non-object body, a bad query parameter                           |
| 400    | `BAD_CSV`           | Unparseable CSV (unterminated quote)                                               |
| 400    | `UNSUPPORTED_QUERY` | The analytics sink cannot answer the query (KV rollups: one filter, see below)     |
| 401    | —                   | Not authenticated (body/headers from the provider's `challenge()` when it has one) |
| 401    | `VIEWER_TOKEN`      | Invalid, tampered or expired viewer token                                          |
| 403    | —                   | Authorization or viewer scope denied; `action` names the action                    |
| 403    | `READONLY`          | The panel is readonly and the action mutates                                       |
| 4xx    | `HOOK_DENIED`       | A `before` hook vetoed (`HookDeniedError`, status from the hook, default 403)      |
| 404    | `NOT_FOUND`         | Unknown tenant / domain / link (also plain `404` for unknown routes)               |
| 405    | —                   | Known path, wrong method                                                           |
| 409    | `CONFLICT`          | Slug or external id taken, hostname registered, domain still has links             |
| 500    | —                   | Unexpected error (including a throwing auth provider)                              |
| 501    | `NOT_CONFIGURED`    | Viewer tokens not enabled / the analytics sink has no raw events                   |

## Meta (public)

### `GET /config` (also `/api/config`)

Bootstrap for the SPA. Never rejects; reflects the presented credentials.

```json
{
  "title": "@xtandard/links",
  "logoUrl": "/logo.svg",
  "basePath": "/links",
  "readonly": false,
  "authenticated": true,
  "principal": { "id": "admin", "email": null, "name": "admin", "roles": ["admin"] },
  "viewer": false,
  "viewerTokens": true,
  "capabilities": {
    "crossFilter": false,
    "uniques": false,
    "events": true,
    "intervals": ["hour", "day"]
  },
  "version": "0.1.0"
}
```

For a viewer token, `viewer: true` plus `tenant`, `links` (when scoped), `allow` and `expiresAt`.
`capabilities` is the analytics sink's: hide cross-filtering when `crossFilter` is false, the events
feed when `events` is false, unique-visitor columns when `uniques` is false.

The SPA page itself also receives the static part (`title`, `basePath`, `readonly`, `logoUrl`,
`version`) as `window.__LINKS_CONFIG__`, plus `<base href="{basePath}/">`.

### `GET /healthcheck`, `GET /api/openapi.json`

`{ "status": "ok", "version": "…" }` and the OpenAPI document. No auth.

## Tenants

| Route                         | Action          | Notes                                                                  |
| ----------------------------- | --------------- | ---------------------------------------------------------------------- |
| `GET /api/tenants`            | `tenant:read`   | `Tenant[]` sorted by key; per-tenant filtered when `"*"` is denied     |
| `GET /api/tenants/:tenant`    | `tenant:read`   | `Tenant` or 404                                                        |
| `PUT /api/tenants/:tenant`    | `tenant:update` | Body `{ name?, metadata? }`; creates or updates; returns `Tenant`      |
| `DELETE /api/tenants/:tenant` | `tenant:delete` | Deletes the tenant, all its links and its own domains → `{ ok: true }` |

`Tenant = { key, name?, metadata?, createdAt, updatedAt }`. Tenants are also created implicitly by
their first link.

## Domains

| Route                           | Action          | Notes                                                                   |
| ------------------------------- | --------------- | ----------------------------------------------------------------------- |
| `GET /api/domains?tenant=`      | `domain:read`   | All domains, or (with `tenant`) shared + that tenant's own; by hostname |
| `POST /api/domains`             | `domain:create` | Body `Domain` → 201; 409 if registered                                  |
| `GET /api/domains/:hostname`    | `domain:read`   | 404 if unknown                                                          |
| `PUT /api/domains/:hostname`    | `domain:update` | Partial `Domain`; `null` clears a field; `hostname` is ignored          |
| `DELETE /api/domains/:hostname` | `domain:delete` | 409 while it has links unless `?force=true` (deletes them) → `{ ok }`   |

```ts
Domain = {
  hostname: string; // lowercase, no scheme/port
  tenant?: string; // unset = shared by every tenant
  rootUrl?: string; // where "/" redirects
  notFoundUrl?: string; // where unknown slugs redirect
  caseSensitive?: boolean; // default false; cannot change while the domain has links (409)
  slugLength?: number; // generated slug length, 3–32, default 7
  isDefault?: boolean; // default domain (per tenant, or shared)
  apps?: { ios?: { appIds: string[]; paths?: string[] }; android?: { packageName; sha256CertFingerprints }[] };
  metadata?: object;
  createdAt; updatedAt;
};
```

## Links

| Route                                       | Action        | Notes                                       |
| ------------------------------------------- | ------------- | ------------------------------------------- |
| `GET /api/tenants/:tenant/links`            | `link:read`   | Paged list (below)                          |
| `POST /api/tenants/:tenant/links`           | `link:create` | Body `CreateLink` → 201 `Link`              |
| `GET /api/tenants/:tenant/links/:id`        | `link:read`   | `Link` (with `clicks`) or 404               |
| `PATCH /api/tenants/:tenant/links/:id`      | `link:update` | Partial `CreateLink`; `null` clears a field |
| `DELETE /api/tenants/:tenant/links/:id`     | `link:delete` | `{ ok: true }`                              |
| `GET /api/tenants/:tenant/links/:id/qr.svg` | `link:read`   | QR code SVG (below)                         |
| `GET /api/tenants/:tenant/links.csv`        | `link:read`   | CSV export (below)                          |
| `POST /api/tenants/:tenant/links/import`    | `link:import` | Bulk import (below)                         |
| `GET /api/tenants/:tenant/tags`             | `link:read`   | `{ tag, count }[]`, most used first         |

**List query:** `search` (case-insensitive on slug, URL, title, tags, domain), `tag`, `domain`,
`archived` (`false` default · `true` · `all`), `limit` (default 50, max 500), `cursor` (the previous
page's `nextCursor`). Newest first. Response: `{ links: Link[], total: number, nextCursor?: string }`
— `total` counts every match before paging.

**`CreateLink`** (only `url` is required; the tenant comes from the path):

```ts
{
  url: string; // http(s) or an app scheme (myapp://…)
  domain?: string; // default: the tenant's default domain, then the shared default
  slug?: string; // default: generated; letters, digits, - _ . ~ and "/" between segments
  title?, description?: string | null;
  tags?: string[];
  externalId?: string | null; // unique per tenant; idempotent imports
  expiresAt?: string | null; expiredUrl?: string | null; maxClicks?: number | null;
  password?: string | null; // write-only; stored as a PBKDF2 hash
  utm?: { source?, medium?, campaign?, term?, content? } | null;
  preview?: { title?, description?, image? } | null; // Open Graph for unfurlers
  rules?: { id?, name?, when: Condition[], url?, variants?: { id?, url, weight }[] }[];
  ios?, android?: string | null; // store/app destinations for those platforms
  deepLink?: { path?: string; deferred?: boolean } | null;
  redirectStatus?: 301 | 302 | 307 | 308 | null;
  trackConversions?, passQuery?, indexable?, disabled?, archived?: boolean;
  metadata?: object | null;
}
```

`Condition` is `{ field: "device"|"os"|"browser"|"country"|"continent"|"language"|"referrer"|"qr", op: "in"|"not_in", values: string[] }`,
`{ field: "query", key, op: "in"|"not_in"|"exists"|"missing", values? }` or
`{ field: "time", after?, before? }` (ADR 0011).

**`Link`** = the stored record: `id` (`lnk_…`), `tenant`, `domain`, `slug`, every `CreateLink`
field that is set, `tags`, `rules` (with generated `id`s), `hasPassword`, `clicks`, `createdAt`,
`updatedAt`, `createdBy` (the actor id).

**QR code:** `qr.svg?size=256&margin=2&fg=000000&bg=ffffff&ecc=M&download=1` — encodes the short URL
with `?qr=1` (so scans are recorded as `qr: true` and match `qr` rule conditions). `fg`/`bg` take hex
(with or without `#`), a colour name, `rgb()`/`hsl()`, or `bg=transparent`. `download=1` adds
`content-disposition: attachment`. Use it as an `<img src>` (cookie/basic auth) or fetch it as a
blob (bearer tokens).

**CSV export:** `links.csv` — the native format (`id,domain,slug,short_url,url,title,…,clicks,created_at`;
tags comma-joined; rules/metadata as JSON; never passwords). Same filters as the list; `archived`
defaults to `all`. Re-importable.

**Import:** two body forms, same result.

- JSON: `{ rows: CreateLink[], dryRun?: boolean, onConflict?: "skip"|"update"|"error" }`.
- CSV: `content-type: text/csv` with the file as the body; query `format`
  (`auto` default · `native` · `bitly` · `dub` · `shlink` · `kutt`), `dryRun`, `onConflict`,
  `domain` (put every row on this domain), `keepDomains` (keep the source domain — off for foreign
  formats), `tags` (comma-separated, added to every row). Column mappings: `src/import.ts`.

`onConflict` (default `skip`) applies when a row's `externalId` or `slug` already exists in the
tenant. Max 10 000 rows. Response:

```json
{
  "created": 2,
  "updated": 0,
  "skipped": 1,
  "errors": 1,
  "rows": [
    { "index": 0, "status": "created", "link": { "...": "Link" } },
    { "index": 3, "status": "error", "error": "link.url: must be an absolute URL" }
  ]
}
```

`index` is the 0-based data row (CSV row `index + 2` counting the header). With `dryRun` nothing is
written and rows carry no `link`.

## Analytics

### `GET /api/tenants/:tenant/analytics` — `analytics:read`

| Query           | Default        | Notes                                                                                                                                   |
| --------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `from`          | `to` − 30 days | inclusive                                                                                                                               |
| `to`            | now            | exclusive                                                                                                                               |
| `interval`      | `day`          | `hour` · `day` · `none` (no timeseries)                                                                                                 |
| `groupBy`       | —              | `link` `domain` `country` `continent` `city` `device` `os` `browser` `referrer` `utm_source` `utm_medium` `utm_campaign` `qr` `variant` |
| `linkIds`       | —              | comma-separated link ids                                                                                                                |
| `limit`         | 10             | breakdown rows                                                                                                                          |
| `filter[<dim>]` | —              | comma-separated values (OR); several dimensions AND                                                                                     |

```json
{
  "totals": { "clicks": 3, "botClicks": 0, "leads": 1, "sales": 1, "saleAmount": 4900 },
  "timeseries": [
    {
      "at": "2026-11-20T00:00:00.000Z",
      "clicks": 3,
      "botClicks": 0,
      "leads": 1,
      "sales": 1,
      "saleAmount": 4900
    }
  ],
  "breakdown": [
    { "key": "US", "clicks": 2, "botClicks": 0, "leads": 0, "sales": 0, "saleAmount": 0 }
  ]
}
```

`timeseries` is present iff `interval` is not `none` (contiguous, zero-filled, ascending);
`breakdown` iff `groupBy` (clicks desc). Missing values read `"(none)"`; referrers read `"(direct)"`;
`qr` reads `"true"`/`"false"`. `uniques` appears when `capabilities.uniques`. Amounts are minor
units. The default KV-rollup sink answers one `filter[...]` at a time, combined with `groupBy` on the
same dimension or `link` — anything else is `400 UNSUPPORTED_QUERY` (`capabilities.crossFilter` is
`false`); ClickHouse/Tinybird sinks answer everything.

### `GET /api/tenants/:tenant/events` — `analytics:read`

Recent raw events, newest first: `linkIds`, `types` (`click,lead,sale`), `before` (ISO, exclusive),
`limit` (default 50, max 1000), `includeBots` (default false). `501` when the sink has no raw events
(`capabilities.events` false). Event shapes: `ClickEvent` / `LeadEvent` / `SaleEvent` in
`src/schema.ts`.

## Conversions

| Route                                | Action             | Notes                      |
| ------------------------------------ | ------------------ | -------------------------- |
| `POST /api/track/lead`               | `conversion:track` | Body `TrackLead` (below)   |
| `POST /api/track/sale`               | `conversion:track` | Body `TrackSale` (below)   |
| `GET /api/tenants/:tenant/customers` | `customer:read`    | `Customer[]`, newest first |

```ts
TrackLead = { tenant?, clickId?, customerId, name? = "Sign up", customerName?, customerEmail?, metadata?, at? };
TrackSale = { tenant?, customerId, amount /* minor units */, currency? = "USD", invoiceId?, name? = "Purchase", clickId?, metadata?, at? };
```

`tenant` defaults to `"default"` (or the viewer's tenant). The click id is the `xl_id` the redirect
appended to the destination (ADR 0010). Response: `{ attributed: true, event, customer, duplicate? }`,
or `{ attributed: false }` when the click / customer is unknown (attribution is best-effort, not an
error). A repeated `invoiceId` returns the original sale with `duplicate: true`.

`Customer = { id, tenant, clickId, linkId, name?, email?, firstSeenAt, metadata? }`.

## Viewer tokens

### `POST /api/tenants/:tenant/viewer-tokens` — `viewer-token:create`

Body (all optional): `{ links?: string[], allow?: LinksAction[], expiresIn?: "1h" | "7d" | ms }`.
`allow` defaults to the panel's `portal.allow`, then `["analytics:read", "link:read"]`, and may only
contain tenant-scoped actions; the caller must itself hold every action it delegates (else `403`
naming it). `501` without `portal.secret`.

```json
{
  "token": "lvt_…",
  "tenant": "acme",
  "links": ["lnk_…"],
  "allow": ["analytics:read", "link:read"],
  "expiresAt": "…"
}
```

Send it as `Authorization: Bearer lvt_…`. Scoping rules: `docs/AUTHORIZATION.md`.

## Audit

| Route                            | Action       | Notes                                                |
| -------------------------------- | ------------ | ---------------------------------------------------- |
| `GET /api/tenants/:tenant/audit` | `audit:read` | `AuditEntry[]`, newest first                         |
| `GET /api/audit`                 | `audit:read` | Global log (tenant deletions, shared-domain changes) |

`AuditEntry = { at, action, actor: { id, email?, name? } | null, target, details? }`, e.g.
`{ action: "link.created", target: "link:lnk_…", details: { slug, domain, url } }`.
