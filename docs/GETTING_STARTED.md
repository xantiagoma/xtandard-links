# Getting started

From `bun add` to a clicked, counted short link in five steps. Everything here runs in one process
on your laptop; [Deployment](DEPLOYMENT.md) covers the production shapes.

## 1. Install

```sh
bun add @xtandard/links    # or npm i / pnpm add / yarn add
```

The package has three small runtime dependencies (`valibot`, `uqr`, `wouter`). Storage drivers,
framework adapters and the React embeds pull in their own optional peers (`pg`, `redis`, `hono`,
`react`, …) only when you import their subpath.

## 2. Mount the panel and the redirect handler

`@xtandard/links` has two handlers (ADR [0004](ADR/0004-panel-and-redirect-handlers.md)): the
**panel** (admin UI + JSON API, mounted under a prefix) and the **redirect handler** (`GET /{slug}`
on your short domain). Share one core between them. With no framework, on Bun:

```ts
// server.ts
import { linksPanel, linksRedirect } from "@xtandard/links/bun";
import { createFileStorage } from "@xtandard/links/storage/file";

const panel = linksPanel({
  storage: createFileStorage({ dir: "./.links/storage" }),
  basePath: "/links",
  defaultDomain: "localhost", // the shared domain links use when they name none
});
const redirects = linksRedirect({ core: panel.core });

Bun.serve({
  port: 3000,
  fetch: (req) =>
    new URL(req.url).pathname.startsWith("/links/") ? panel.fetch(req) : redirects.fetch(req),
});
```

```sh
bun server.ts
```

Open `http://localhost:3000/links/` for the dashboard. Hono, Elysia, Express and Next.js are the
same two calls in each framework's idiom: see [Adapters](ADAPTERS.md).

> [!WARNING]
> With no `auth` option the panel is open to anyone who can reach it. Fine on localhost, never in
> production: see [Auth](AUTH.md) and [Authorization](AUTHORIZATION.md).

## 3. Create a link

From your own code (the core is on `panel.core`):

```ts
const link = await panel.core.createLink({
  url: "https://example.com/pricing",
  slug: "pricing", // omit for a generated 7-character slug
  utm: { source: "newsletter" },
});
// link.domain === "localhost", link.slug === "pricing"
```

or over the HTTP API (the tenant is `default` unless you use tenants):

```sh
curl -X POST http://localhost:3000/links/api/tenants/default/links \
  -H 'content-type: application/json' \
  -d '{ "url": "https://example.com/pricing", "slug": "pricing" }'
```

or in the dashboard's **New link** form.

## 4. Click it

Open `http://localhost:3000/pricing` in a browser. You land on
`https://example.com/pricing?utm_source=newsletter`.

The redirect answered from memory and handed the click to a background ingestor; about a second
later (the default flush interval) the click is in the analytics sink.

> [!NOTE]
> `curl` is a bot as far as the click pipeline is concerned (`curl/` is on the built-in bot list):
> its clicks are recorded with `bot: true` and counted as `botClicks`, not `clicks`. Click from a
> browser, or send a browser user agent with `curl -A 'Mozilla/5.0 …'`.

## 5. Read the numbers

The dashboard's **Analytics** page shows clicks over time, top links, countries, devices and
referrers. From code:

```ts
const stats = await panel.core.queryAnalytics({
  tenant: "default",
  from: new Date(Date.now() - 86_400_000).toISOString(),
  to: new Date().toISOString(),
  interval: "hour",
  groupBy: "browser",
});
// stats.totals.clicks === 1, stats.breakdown[0].key === "chrome"
```

or `GET /links/api/tenants/default/analytics?groupBy=browser` (see [HTTP API](HTTP_API.md)).

Running locally there are no edge geo headers, so `country` reads `(none)`; behind Cloudflare,
Vercel, CloudFront or Fastly it fills in on its own (see [Analytics](ANALYTICS.md)).

## Next steps

- **Your own short domain.** Register it once (`core.createDomain({ hostname: "go.acme.com",
isDefault: true })`), point DNS at your app and let your edge terminate TLS. Customers can own
  their branded domains: [Links & domains](LINKS.md).
- **Targeting and A/B tests**: [Rules](RULES.md).
- **Real storage**: Postgres, Redis, MongoDB, SQLite, Drizzle and more: [Storage](STORAGE.md).
- **Analytics at scale**: ClickHouse, Tinybird, Workers Analytics Engine: [Analytics](ANALYTICS.md).
- **Signups and sales per link**: [Conversions](CONVERSIONS.md).
- **Universal links and deferred deep links**: [Deep links](DEEP_LINKS.md).
- **Per-customer analytics in your product**: [Analytics widget](WIDGET.md).
- **No code at all**: `npx @xtandard/links serve` runs the same panel and redirects; see
  [CLI](CLI.md) and [Deployment](DEPLOYMENT.md).
