# Examples

Each example is a standalone mini-project — copy it out, `bun install`, run.

| Example                                       | What it shows                                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`hono/`](./hono)                             | Panel at `/links` + `linksRedirect` middleware in front of your routes, SQLite storage.              |
| [`elysia/`](./elysia)                         | The typed `linksElysia` plugin + redirects, and an **Eden treaty** client (`demo.ts`).               |
| [`express/`](./express)                       | Panel + redirect middleware before `express.json()`; a signup route that tracks a lead.              |
| [`bun/`](./bun)                               | `Bun.serve`, no framework: path routing, a targeting rule, `fallback` to your app.                   |
| [`conversions/`](./conversions)               | Script: click → `trackLead` → `trackSale` (idempotent) → clicks, leads and revenue.                  |
| [`deep-links/`](./deep-links)                 | Script: AASA / assetlinks, App Store / Play Store fallbacks, the deferred-claim round trip.          |
| [`storage-drivers/`](./storage-drivers)       | Script: the same create → click → rollup loop on every storage backend.                              |
| [`webhooks-bridge/`](./webhooks-bridge)       | Script: `bridges/webhooks` + `bridges/audit` turning link activity into events.                      |
| [`react-embed/`](./react-embed)               | `<LinksDashboard>` and the per-tenant `<LinkAnalytics>` widget (viewer token) in a Vite app.         |
| [`nextjs/`](./nextjs)                         | App Router: the panel on `app/links/[[...path]]/route.ts`, redirects in `middleware.ts`.             |
| [`cloudflare-workers/`](./cloudflare-workers) | A Worker on Workers KV + Analytics Engine: edge redirects with `ctx.waitUntil` and `request.cf` geo. |

## Storage backends

Every backend implements the same four-method KV contract. Where each is
demonstrated:

| Backend               | Import                                  | Demonstrated in                                                          |
| --------------------- | --------------------------------------- | ------------------------------------------------------------------------ |
| memory                | `@xtandard/links/storage/memory`        | [`storage-drivers/`](./storage-drivers), [`react-embed/`](./react-embed) |
| file                  | `@xtandard/links/storage/file`          | [`elysia/`](./elysia), [`express/`](./express), [`nextjs/`](./nextjs)    |
| sqlite (`bun:sqlite`) | `@xtandard/links/storage/sqlite`        | [`hono/`](./hono), [`bun/`](./bun)                                       |
| redis                 | `@xtandard/links/storage/redis`         | `storage-drivers/` (behind `REDIS_URL`)                                  |
| postgres              | `@xtandard/links/storage/postgres`      | `storage-drivers/` (behind `DATABASE_URL`)                               |
| mongodb               | `@xtandard/links/storage/mongodb`       | `storage-drivers/` (behind `MONGO_URL`)                                  |
| libsql / Turso        | `@xtandard/links/storage/libsql`        | `storage-drivers/` (behind `LIBSQL_URL`)                                 |
| cloudflare-kv         | `@xtandard/links/storage/cloudflare-kv` | [`cloudflare-workers/`](./cloudflare-workers)                            |
| unstorage             | `@xtandard/links/storage/unstorage`     | bridge to Upstash, S3, Vercel KV, …                                      |
| drizzle               | `@xtandard/links/storage/drizzle`       | reuse your app's existing Drizzle database                               |

These examples depend on the package via `file:../..`, so they run against your
local checkout. **Build the package once at the repo root first** (`dist/` and the
bundled admin UI must exist):

```bash
cd ..            # repo root
bun install
bun run build
```

When using the published package instead, swap the dependency for
`"@xtandard/links": "^0.1.0"`.

## Run from the repo root (auto-install + free port)

From the repo root, after `bun run build`, convenience scripts install the
example on first use and launch it on a **free port** (via `get-port-please`, so
you can run several at once):

```bash
bun run examples:hono              # or: elysia | express | bun
bun run examples:conversions       # script examples (no server)
bun run examples:deep-links
bun run examples:storage-drivers   # REDIS_URL / DATABASE_URL / MONGO_URL / LIBSQL_URL add backends
bun run examples:react-embed       # seeded panel on :3702 + vite host app
bun scripts/example.ts webhooks-bridge
```

Each server prints the URL it chose, e.g. `> hono → http://localhost:3001/links`.

`nextjs/` and `cloudflare-workers/` run with their own toolchains (`next dev`,
`wrangler dev`) — see their READMEs. In this repository all examples are
type-checked together: `bun run typecheck:examples`.
