# Authorization

May this principal do this? Evaluated per request against an action + resource pair; three providers
ship.

## Actions and resources

```ts
type LinksAction =
  | "tenant:read"
  | "tenant:update"
  | "tenant:delete"
  | "domain:read"
  | "domain:create"
  | "domain:update"
  | "domain:delete"
  | "link:read"
  | "link:create"
  | "link:update"
  | "link:delete"
  | "link:import"
  | "analytics:read"
  | "customer:read"
  | "audit:read"
  | "conversion:track"
  | "viewer-token:create";

type LinksResource =
  | { type: "tenant"; tenant: string } // "*" = all tenants (listing)
  | { type: "domain"; hostname: string; tenant?: string } // no tenant = shared domain
  | { type: "link"; tenant: string; linkId?: string }
  | { type: "analytics"; tenant: string; linkIds?: string[] }
  | { type: "customer"; tenant: string }
  | { type: "audit"; tenant?: string } // no tenant = the global log
  | { type: "conversion"; tenant: string }
  | { type: "viewer-token"; tenant: string };
```

Every resource carries the `tenant` it belongs to, so a provider can answer per-tenant questions, not
just per-verb ones. Two routes adapt to per-tenant policies:

- `GET /api/tenants` asks about `tenant: "*"` first; if that is denied it lists only the tenants the
  principal may read (403 when none).
- `PUT /api/domains/:hostname` moving a domain to another tenant also needs `domain:update` on the
  target tenant.

`MUTATING_ACTIONS` / `isMutatingAction` are exported for "read-only vs write" policies. The panel's
`readonly` option denies every mutating action with `403 { code: "READONLY" }` before any provider
runs (`conversion:track` counts as mutating; minting viewer tokens does not).

## Bundled providers

### `@xtandard/links/authorization/none` (default)

Everything allowed. Pair only with real auth or a private network.

### `@xtandard/links/authorization/roles`

```ts
import { rolesAuthorization, DEFAULT_ROLE_POLICY } from "@xtandard/links/authorization/roles";

const authorization = rolesAuthorization(); // DEFAULT_ROLE_POLICY
```

Maps `principal.roles` through a policy:

| Role     | Grant                                                                                         |
| -------- | --------------------------------------------------------------------------------------------- |
| `admin`  | `"*"` — everything                                                                            |
| `editor` | every concrete action (`ALL_ACTIONS`)                                                         |
| `viewer` | `READ_ACTIONS` — every `*:read` action; minting tokens and tracking conversions are not reads |

Supply your own `policy` to rename roles or narrow grants; unknown roles grant nothing; a principal
needs at least one granting role per action. `readonly: true` denies every mutating action.

```ts
rolesAuthorization({
  policy: {
    admin: "*",
    marketing: ["link:read", "link:create", "link:update", "analytics:read", "domain:read"],
    tracker: ["conversion:track"], // a backend API key for /api/track/*
  },
});
```

### `@xtandard/links/authorization/delegated`

```ts
import { delegatedAuthorization } from "@xtandard/links/authorization/delegated";

const authorization = delegatedAuthorization({
  authorize: ({ principal, resource }) =>
    resource.tenant === undefined || // shared domains, global audit
    (principal?.metadata as { tenants?: string[] })?.tenants?.includes(resource.tenant) === true,
});
```

Bridge to whatever your app uses (Casbin, OPA, Cedar, hand-rolled ACLs). Synchronous or async.

## Viewer principals bypass all of this — on purpose

A request authenticated by a viewer token (`Bearer lvt_…`) is authorized by the token's own
force-scoping; your authorization provider is **never consulted** for it. Defense in depth: a bug in
host policy code can't widen a customer's widget into another tenant.

- **Tenant:** only the token's tenant. Shared domains (no tenant) are readable when `domain:read` is
  granted; nothing else outside the tenant is reachable, including the global audit log.
- **Actions:** the token's `allow`, else the panel's `portal.allow`, else
  `DEFAULT_VIEWER_ACTIONS = ["analytics:read", "link:read"]` — intersected with
  `VIEWER_GRANTABLE_ACTIONS` (tenant-scoped actions only: `tenant:read`, `domain:read`, `link:*`,
  `analytics:read`, `customer:read`, `audit:read`, `conversion:track`). Tenant/domain management and
  `viewer-token:create` can never be granted.
- **Links:** when the token has `links`, link lists, tags, the CSV export, customers and the audit
  log are filtered to them; reading or changing any other link is a `403`; analytics and events
  queries are clamped to them (asking only for other links is a `403`); and creating or importing
  links is denied (a new link would not be in the set).

`/config` reports `viewer: true`, `tenant`, `links` and `allow` so the UI renders the reduced widget
chrome. See ADR 0009 and `docs/AUTH.md#viewer-tokens`.
