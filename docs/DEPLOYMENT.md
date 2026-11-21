# Deployment

Five shapes, from "two lines in your existing app" to "redirects on the edge, admin elsewhere". The
[architecture](ARCHITECTURE.md#deployment-shapes) page explains why they all work: the control
plane and the redirect plane share only the storage and the analytics sink.

| Shape                                     | When                                                |
| ----------------------------------------- | --------------------------------------------------- |
| [Embedded](#embedded)                     | the default: you have a Node/Bun app and a database |
| [Path-prefixed](#path-prefixed-links)     | no dedicated short domain: `acme.com/l/x7k2`        |
| [Standalone](#standalone-cli-and-docker)  | no code: the CLI or the Docker image                |
| [Cloudflare Workers](#cloudflare-workers) | redirects at the edge, close to visitors            |
| [Vercel / Next.js](#vercel--nextjs)       | a Next.js app on Vercel                             |

DNS and TLS for your short domains are always your edge's job: point `go.acme.com` at whatever
serves the redirect handler, terminate TLS there (Cloudflare, Vercel, Caddy, a load balancer), and
register the hostname with `core.createDomain`.

## Embedded

Mount both handlers in your app and share one core ([Adapters](ADAPTERS.md)):

```ts
import { Hono } from "hono";
import { basicAuth } from "@xtandard/links/auth/basic";
import { rolesAuthorization } from "@xtandard/links/authorization/roles";
import { linksPanel, linksRedirect } from "@xtandard/links/hono";
import { createPostgresStorage } from "@xtandard/links/storage/postgres";

const panel = linksPanel({
  storage: createPostgresStorage({ connectionString: process.env.DATABASE_URL }),
  basePath: "/links",
  auth: basicAuth({
    users: [{ username: "ops", passwordHash: process.env.LINKS_ADMIN_HASH!, roles: ["admin"] }],
  }),
  authorization: rolesAuthorization({}),
  portal: { secret: process.env.LINKS_VIEWER_SECRET! }, // analytics widget tokens
});

const app = new Hono();
app.route("/links", panel);
app.use(
  linksRedirect({
    core: panel.core,
    privacy: { salt: process.env.LINKS_VISITOR_SALT }, // same on every instance
  }),
);
```

With several instances behind a load balancer:

- Use a storage with **compare-and-swap** (Postgres, Redis, MongoDB, libSQL, Drizzle over
  Postgres/SQLite) so slug claims are race-free, and ideally one with **watch** (Redis, or
  `withWatch` + `pgListenNotify` for Postgres) so edits evict every instance's cache at once.
  Without watch, an edit made on one instance reaches the others within the resolver TTL (60 s).
  See [Storage](STORAGE.md).
- Set the same `privacy.salt` everywhere, or unique-visitor counts, A/B stickiness and deferred
  deep-link matching break across instances ([Analytics](ANALYTICS.md#privacy)).
- On shutdown, flush what is queued: `await redirects.handler.close()` (pending clicks and click
  counters) and `await panel.core.close()`.
- Schedule maintenance: `core.prune()` (expired click refs and deferred handoffs) and, with the
  default KV analytics, `core.analytics.prune()` (bucket retention). A daily cron running
  `xtandard-links prune` with the same storage env does both.

## Path-prefixed links

No short domain? Serve links under a path on your main host:

```ts
const panel = linksPanel({ storage, basePath: "/links", redirectBasePath: "/l" });
app.use(linksRedirect({ core: panel.core, basePath: "/l", defaultDomain: "acme.com" }));
// https://acme.com/l/spring → the "spring" link
```

With `basePath`, the redirect handler only looks at paths under it, on any host: links are looked
up on the request host when it is a registered domain, else on `defaultDomain`. The panel's
`redirectBasePath` makes QR codes and short URLs in the UI include the prefix.

## Standalone: CLI and Docker

No code: the panel and the redirect handler on one port, configured by environment variables.

```sh
npx @xtandard/links serve          # or: bunx @xtandard/links serve
# panel on http://localhost:3000/links, redirects on http://localhost:3000/{slug}
```

The Docker image runs the same server under Bun:

```sh
docker run -d -p 3000:3000 \
  -e STORAGE_DRIVER=postgres -e DATABASE_URL=postgres://… \
  -e DEFAULT_DOMAIN=go.acme.com \
  -e AUTH_MODE=basic -e AUTH_USERNAME=admin -e AUTH_PASSWORD_HASH='scrypt$…' \
  -e VIEWER_SECRET=… \
  ghcr.io/xantiagoma/xtandard-links:latest
```

The image defaults to **`memory` storage** (an ephemeral demo); set `STORAGE_DRIVER` for anything
real. For a single container with local persistence, mount a volume and use SQLite:
`-e STORAGE_DRIVER=sqlite -e STORAGE_SQLITE_PATH=/data/links.sqlite -v links-data:/data`. Build it
yourself from the repository root with `docker build -f apps/standalone/Dockerfile -t xtandard-links .`.

| Variable                                                 | Default                                                | Notes                                                                |
| -------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| `STORAGE_DRIVER`                                         | `file` (CLI) · `memory` (Docker)                       | `memory`, `file`, `redis`, `postgres`, `mongodb`, `sqlite`, `libsql` |
| `STORAGE_FILE_DIR`                                       | `./.links/storage`                                     | `file`                                                               |
| `STORAGE_SQLITE_PATH`                                    | `./.links/links.sqlite`                                | `sqlite` (Bun only; the image is Bun)                                |
| `REDIS_URL`, `STORAGE_PREFIX`                            | `redis://localhost:6379`, `xtandard:links`             | `redis`                                                              |
| `DATABASE_URL` / `POSTGRES_URL`, `STORAGE_PG_TABLE`      | `…/postgres`, `xtandard_links`                         | `postgres`                                                           |
| `MONGO_URL`, `MONGO_DB`, `STORAGE_MONGO_COLLECTION`      | `mongodb://localhost:27017`, `xtandard_links`, `links` | `mongodb`                                                            |
| `LIBSQL_URL` / `STORAGE_LIBSQL_URL`, `LIBSQL_AUTH_TOKEN` | `file:./.links/links.db`                               | `libsql`                                                             |
| `DEFAULT_DOMAIN`                                         | `localhost`                                            | the shared default domain                                            |
| `PORT`                                                   | `3000`                                                 |                                                                      |
| `BASE_PATH`                                              | `/links`                                               | panel mount path; `/` redirects there                                |
| `REDIRECT_BASE_PATH`                                     | —                                                      | also serve links under this prefix on any host (`/l`)                |
| `AUTH_MODE`                                              | `none`                                                 | `none` or `basic` (one admin user)                                   |
| `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`                    | `admin`                                                | scrypt hash ([Auth](AUTH.md)); `AUTH_PASSWORD` for dev only          |
| `VIEWER_SECRET`                                          | —                                                      | enables analytics viewer tokens (alias `PORTAL_SECRET`)              |
| `VISITOR_SALT`                                           | random per process                                     | shared visitor-hash salt; set it when running several instances      |
| `TITLE`, `LOGO_URL`                                      | `@xtandard/links`                                      | navbar wordmark / logo                                               |
| `READONLY`                                               | —                                                      | `1` / `true` blocks every mutation                                   |

`GET /healthcheck` answers `{ status: "ok", title, version }` (the image's `HEALTHCHECK` uses it).
The standalone server uses the KV analytics sink in the same storage and edge-header geo, and
takes its visitor-hash salt from `VISITOR_SALT` (random per process when unset: set it before
running more than one container). For an OLAP sink or custom auth, embed the library instead. The CLI's other commands work against the same storage ([CLI](CLI.md)).

## Cloudflare Workers

Run the redirect plane in a Worker, close to visitors. It has no optional dependencies, reads geo
from `request.cf`, and keeps background writes alive with `ctx.waitUntil`:

```ts
// worker.ts
import { createLinksCore, createRedirectHandler, type RedirectHandler } from "@xtandard/links";
import { createCloudflareKvStorage } from "@xtandard/links/storage/cloudflare-kv";
import { createAnalyticsEngine } from "@xtandard/links/analytics/analytics-engine";

interface Env {
  LINKS: KVNamespace;
  LINKS_ANALYTICS: AnalyticsEngineDataset;
  VISITOR_SALT: string;
}

let handler: RedirectHandler | undefined; // one per isolate: the resolver cache survives requests

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    handler ??= createRedirectHandler({
      core: createLinksCore({
        storage: createCloudflareKvStorage({ namespace: env.LINKS }),
        analytics: createAnalyticsEngine({
          dataset: env.LINKS_ANALYTICS,
          datasetName: "links_events",
        }),
      }),
      ingestor: { flushIntervalMs: 0 }, // no timers in isolates; waitUntil flushes per request
      privacy: { salt: env.VISITOR_SALT },
    });
    return handler.fetch(request, ctx); // ctx.waitUntil keeps the click write alive
  },
};
```

```toml
# wrangler.toml
name = "links-redirects"
main = "worker.ts"
compatibility_date = "2026-11-01"
routes = [{ pattern = "go.acme.com/*", zone_name = "acme.com" }]

[[kv_namespaces]]
binding = "LINKS"
id = "…"

[[analytics_engine_datasets]]
binding = "LINKS_ANALYTICS"
dataset = "links_events"
```

Choosing the storage for the edge:

- **Workers KV** is the natural fit for reads, but it is eventually consistent and has no
  compare-and-swap ([Storage](STORAGE.md#without-compare-and-swap)), and only Workers can reach the
  binding, so links must be managed from a Worker too.
- **libSQL/Turso** (over HTTP), **Postgres** (through Hyperdrive or a serverless driver: the
  Postgres driver accepts any client with `query(text, params)`), or **Redis over HTTP** (Upstash
  through the unstorage driver) can be shared with an admin server running anywhere.

The analytics: Workers Analytics Engine as above (sampled at volume, three months), or ClickHouse /
Tinybird, which are `fetch`-based and also readable from the admin side. Avoid the KV rollup sink on
Workers KV: rollups are read-modify-write and KV writes are limited per key.

Click counters (the `clicks` shown in lists, and `maxClicks`) are flushed with the request's
`waitUntil` on edge runtimes, so they persist even though isolate timers do not.

**Managing links on a Workers-only setup.** The panel's JSON API runs in a Worker (enable
`nodejs_compat` for its imports), but the bundled UI is served from the file system, which a Worker
does not have: mount the panel there as an API (create links with `POST /links/api/…`, the CLI is
not an option since it cannot reach the KV binding) or keep the control plane on a storage an
admin server can also reach (above). The runnable
[`examples/cloudflare-workers`](../examples/cloudflare-workers) does the former: redirects and an
API-only panel under `/links` (guarded by a token) in one Worker on Workers KV + Analytics Engine.

## Vercel / Next.js

The panel as route handlers, the redirect plane as middleware ([Adapters](ADAPTERS.md#nextjs-app-router)):

```ts
// lib/links.ts
import { createLinksCore } from "@xtandard/links";
import { createPostgresStorage } from "@xtandard/links/storage/postgres";
import { createTinybirdAnalytics } from "@xtandard/links/analytics/tinybird";
import { Pool } from "@neondatabase/serverless"; // edge-compatible; any query(text, params) client

export const core = createLinksCore({
  storage: createPostgresStorage({
    client: new Pool({ connectionString: process.env.DATABASE_URL }),
  }),
  analytics: createTinybirdAnalytics({ token: process.env.TINYBIRD_TOKEN! }),
  defaultDomain: "go.acme.com",
});
```

```ts
// app/links/[[...path]]/route.ts: the admin panel (Node runtime: it serves the UI from disk)
import { linksRouteHandlers } from "@xtandard/links/next";
import { core } from "@/lib/links";
export const { GET, POST, PUT, PATCH, DELETE, OPTIONS } = linksRouteHandlers({
  core,
  basePath: "/links",
  auth: myAuth, // e.g. delegatedAuth over your session (docs/AUTH.md)
});
```

```ts
// middleware.ts: the redirect plane
import { linksMiddleware } from "@xtandard/links/next";
import { core } from "@/lib/links";

const redirects = linksMiddleware({ core, privacy: { salt: process.env.LINKS_VISITOR_SALT } });

export default function middleware(
  request: Request,
  event: { waitUntil(p: Promise<unknown>): void },
) {
  return redirects(request, event); // a Response for short links, undefined to continue
}
export const config = { matcher: ["/((?!_next|links|api).*)"] };
```

Geo comes from Vercel's `x-vercel-ip-*` headers with no configuration, and `event.waitUntil` keeps
the click write alive after the response. Each middleware isolate has its own resolver cache; use a
storage with watch, or accept the TTL, for cross-instance edits. Prefer an OLAP sink (Tinybird,
ClickHouse) over KV rollups when clicks are written from many short-lived isolates.

## Production checklist

- [ ] The panel has `auth` and `authorization` (never `AUTH_MODE=none` on a reachable host), and its
      first path segment does not collide with slugs on shared hosts ([Adapters](ADAPTERS.md)).
- [ ] A storage with compare-and-swap when more than one process writes.
- [ ] `privacy.salt` (`VISITOR_SALT` for the standalone server) set to the same secret on every
      redirect instance.
- [ ] `getIp` trusts only headers your proxy sets ([Analytics](ANALYTICS.md#geo)).
- [ ] `portal.secret` / `VIEWER_SECRET` set if you embed the widget; rotate it to revoke tokens.
- [ ] A schedule for `core.prune()` (and `analytics.prune()` with KV rollups).
- [ ] Graceful shutdown flushes the ingestor and counters (`handler.close()`).
- [ ] `/.well-known/` reachable over HTTPS without auth on domains with apps ([Deep links](DEEP_LINKS.md)).
- [ ] A `urlPolicy` if untrusted users create links (phishing / malware block lists,
      [Links](LINKS.md#destination-policy)).
