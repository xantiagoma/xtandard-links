# Adapters

Two handlers, every framework (ADR 0004). Each adapter exports:

- **`linksPanel(options)`** — the admin panel (JSON API, OpenAPI, SPA, viewer tokens) wrapping
  `createFetchHandler`, with `.core` (call `core.createLink()` from your own routes) and
  `.openapi()` (merge into your docs) attached.
- **`linksRedirect(options)`** — the redirect plane wrapping `createRedirectHandler`, as the
  framework's fall-through idiom: short links are answered, everything else continues to your
  routes. `.handler` is the underlying redirect handler (`core`, `resolver`, `close()`).

`linksPanel` takes `LinksPanelOptions` (`storage` or `core`, `analytics`, `defaultDomain`,
`basePath`, `auth`, `authorization`, `portal`, `readonly`, `title`, `logoUrl`, `hooks`, `cors`, …).
`linksRedirect` takes `RedirectHandlerOptions` (`core` or `storage`, `basePath`, `privacy`,
`conversions`, `geo`, …) **or a prebuilt redirect handler**. Share one core between the two:
`linksRedirect({ core: panel.core })`.

**What falls through.** The redirect handler returns "not mine" for unregistered hosts, reserved
first segments (`api`, `_links`, `.well-known`, … — `reservedSlugs` on the core), bare `/` without a
`rootUrl`, and **unknown slugs** — unless the domain sets `notFoundUrl`, which then answers them with
a redirect. So the redirect middleware can sit in front of your own routes on a shared host; on a
dedicated short domain set `notFoundUrl`, or use `fetch`, which renders the built-in 404 page.
Routing the panel first (as below) is still the cheapest order.

## Bun

```ts
import { linksPanel, linksRedirect } from "@xtandard/links/bun";

const panel = linksPanel({ storage, basePath: "/links", defaultDomain: "go.acme.com" });
const redirects = linksRedirect({ core: panel.core, fallback: (req) => app.fetch(req) });

Bun.serve({
  port: 3000,
  fetch: (req) =>
    new URL(req.url).pathname.startsWith("/links/") ? panel.fetch(req) : redirects.fetch(req),
});
```

`redirects.fetch(req, server?)` answers short links and calls `fallback(req, server)` otherwise
(default: the 404 page). `redirects.handle(req, ctx?)` is the raw `Response | null`.

## Hono

```ts
import { Hono } from "hono";
import { linksPanel, linksRedirect } from "@xtandard/links/hono";

const app = new Hono();
const panel = linksPanel({ storage, basePath: "/links" });
app.route("/links", panel); // first: Hono runs handlers in registration order
app.use(linksRedirect({ core: panel.core })); // short links, else next()
app.get("/", (c) => c.text("home"));
```

On Cloudflare Workers the middleware passes `c.executionCtx.waitUntil`, so click recording outlives
the response; on Bun/Node (no execution context) it records in the background.

## Elysia

```ts
import { Elysia } from "elysia";
import { linksPanel, linksRedirect } from "@xtandard/links/elysia";

const panel = linksPanel({ storage, basePath: "/links" });
new Elysia()
  .use(linksRedirect({ core: panel.core })) // answers short links in onRequest, before routing
  .mount("/links", panel)
  .listen(3000);
```

For end-to-end typed clients (Eden), use the typed plugin — it declares every admin route with
params and body schemas, and exposes its core as `decorator.linksCore`:

```ts
import { linksElysia, linksRedirect } from "@xtandard/links/elysia";

const admin = linksElysia({ prefix: "/links", storage });
const app = new Elysia()
  .use(admin)
  .use(linksRedirect({ core: admin.decorator.linksCore }))
  .listen(3000);
export type App = typeof app; // treaty<App>: client.links.api.tenants({ tenant }).links.get()
```

Because `linksRedirect` runs in `onRequest`, it sees every request first: put the panel on a host
that is not a registered short domain (or reserve its first path segment) — see "What falls
through" above.

### Elysia 2 — `@xtandard/links/elysia2`

Elysia 2 routes take `(path, hook, handler)` instead of `(path, handler, hook)`, and its class
generics changed, so a plugin's `.d.ts` built against one major doesn't type-check (or feed Eden) on
the other. `@xtandard/links/elysia2` is the same surface — `linksPanel`, `linksElysia`,
`linksRedirect` — built and typed against Elysia 2:

| Elysia | Import from               | Eden client      |
| ------ | ------------------------- | ---------------- |
| 1.x    | `@xtandard/links/elysia`  | `@elysiajs/eden` |
| 2.x    | `@xtandard/links/elysia2` | `@elysia/eden`   |

## Express

```ts
import express from "express";
import { linksPanel, linksRedirect } from "@xtandard/links/express";

const app = express();
const panel = linksPanel({ storage, basePath: "/links" });
app.use("/links", panel); // BEFORE express.json()/body-parser
app.use(linksRedirect({ core: panel.core })); // short links, else next()
app.use(express.json());
```

The panel buffers request bodies (if a body parser already consumed the stream, `req.body` is
re-serialized). The redirect middleware only reads a POST body when the redirect handler actually
needs it — a password form for one of its links — so your own body parsers downstream still see an
untouched stream.

## Next.js (app router)

No `next` import — web-standard only, so it works across Next versions and on the Edge runtime.

```ts
// app/links/[[...path]]/route.ts — the admin panel
import { linksRouteHandlers } from "@xtandard/links/next";
export const { GET, POST, PUT, PATCH, DELETE, OPTIONS } = linksRouteHandlers({
  storage,
  basePath: "/links",
});
```

```ts
// middleware.ts — the redirect plane
import { linksMiddleware } from "@xtandard/links/next";

const redirects = linksMiddleware({ storage, defaultDomain: "go.acme.com" });

export default async function middleware(
  request: Request,
  event: { waitUntil(p: Promise<unknown>): void },
) {
  return redirects(request, event); // Response for short links, undefined to continue
}
export const config = { matcher: ["/((?!_next|links).*)"] };
```

`linksMiddleware` (alias `linksRedirect`) resolves `undefined` for anything that is not a short
link, which Next treats as "continue"; it passes `event.waitUntil` along.

## Sharing one core

Reuse the panel's `core` for the redirect handler and for your own calls — don't create a second
core over the same storage in the same process (it works, but caches and counters would be split):

```ts
const panel = linksPanel({ storage });
app.post("/campaigns", async (req) => {
  const link = await panel.core.createLink({ tenant: req.workspace, url: req.body.url });
  // …
});
```
