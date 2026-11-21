# ADR 0004 — Two Handlers: Admin Panel and Redirect Handler

**Status:** Accepted (★ deviation: flags/webhooks expose a single panel handler)

---

## Context

The admin panel mounts under a prefix (`/links`) behind the host's auth. Redirects are the opposite:
they live at the **root of a branded host** (`go.acme.com/x7k2`), often on the same server as the
host app (`acme.com/l/x7k2`), are anonymous, and must coexist with the host's own routes.

## Decision

- `createFetchHandler(options)` → `{ fetch, core, openapi }` is the admin panel, identical in shape
  to webhooks (JSON API, OpenAPI, SPA, CORS, base path, auth, authorization, viewer tokens), plus the
  **conversion tracking endpoints** (`POST /api/track/lead|sale`, authenticated by a publishable or
  secret key — ADR 0010).
- `createRedirectHandler(options)` → `{ fetch, handle, resolver, ingestor, core }` is the redirect
  plane. `handle(request, ctx?)` returns `Response | null`: `null` means "not mine" (unknown host,
  reserved path, no slug) so the host can fall through to its own router. `fetch` never returns
  `null` (it answers 404 instead) for standalone use. It also serves `/.well-known/` deep-link
  files for configured domains (ADR 0008) and the password and link-preview pages.
- Each framework adapter exports both: `linksPanel(options)` and `linksRedirect(options)` (Elysia
  plugin with fall-through, Hono middleware calling `next()` on `null`, Express middleware calling
  `next()`, Bun passthrough, Next middleware helper).
- Domain routing: a redirect handler serves the hosts registered as domains; with `basePath`
  (`/l`) it also serves path-prefixed links on any host (`acme.com/l/x7k2`) for hosts without a
  dedicated short domain.

## Consequences

- Hosts choose topology: one process with both handlers, or the redirect handler alone on an edge
  runtime (Workers) with the panel elsewhere, both pointing at the same storage and sink.
- Two option objects to configure; both accept a prebuilt `core` to share one instance.
