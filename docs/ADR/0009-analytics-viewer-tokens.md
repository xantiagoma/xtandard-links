# ADR 0009 — Analytics Viewer Tokens

**Status:** Accepted (★ adapts webhooks ADR 0006 "portal tokens")

---

## Context

The flagship embed is a **per-tenant analytics widget**: the host shows each of its customers the
clicks on _their_ links, inside the host's UI. That needs tenant-scoped, read-only access for
principals the host authenticates — without sessions or a token table.

## Decision

`createViewerToken(secret, { tenant, links?, allow?, expiresIn })` produces
`lvt_` + base64url(`{ tenant, links?, allow?, exp }`) + `.` + base64url(HMAC-SHA256), verified
statelessly by a panel configured with `portal: { secret }` (Web Crypto only).

Viewer principals are **force-scoped and closed**: only their tenant, only the listed link ids when
`links` is set, and only the actions in `allow` (default `["analytics:read", "link:read"]`; hosts
may add `link:create`/`link:update` to let customers manage their own links through the same
embed). The host's authorization provider is not consulted for viewer principals.

The widget is the same SPA under reduced chrome (`/config` reports `viewer: true`) and the
`<LinkAnalytics token=… />` React embed.

## Consequences

- Two lines for a host: mint a token in a route handler, render `<LinkAnalytics>`.
- Revocation before expiry = rotating the secret (documented). Default expiry 1 day.
