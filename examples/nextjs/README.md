# nextjs × @xtandard/links

The App Router wiring: the admin panel on a catch-all route handler and the
redirect plane in middleware. The adapter has no `next` import — web-standard
`Request`/`Response` only — so it works across Next versions.

```ts
// app/links/[[...path]]/route.ts — the admin panel
import { linksRouteHandlers } from "@xtandard/links/next";
export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = linksRouteHandlers({
  storage,
  basePath: "/links",
  defaultDomain: "localhost",
});
```

```ts
// middleware.ts — the redirect plane
import { linksMiddleware } from "@xtandard/links/next";
const redirects = linksMiddleware({ storage, defaultDomain: "localhost" });
export default (request: Request, event: { waitUntil(p: Promise<unknown>): void }) =>
  redirects(request, event); // Response for short links, undefined to continue
export const config = { runtime: "nodejs", matcher: ["/((?!_next/|links|favicon.ico).*)"] };
```

## Files

- [`lib/links.ts`](./lib/links.ts) — the storage both sides share (file storage here; use
  Postgres/Redis/Upstash in production).
- [`app/links/[[...path]]/route.ts`](./app/links/[[...path]]/route.ts) — the panel (UI + JSON API).
- [`middleware.ts`](./middleware.ts) — short links; everything else continues to your pages.
- [`next.config.mjs`](./next.config.mjs) — `serverExternalPackages: ["@xtandard/links"]` so the
  panel finds its bundled UI.

On **Next 16** rename `middleware.ts` to `proxy.ts` and export `proxy`. With an
HTTP-based store (Upstash / Vercel KV through `storage/unstorage`) drop
`runtime: "nodejs"` to run the redirect plane on the Edge runtime.

## Run it

```bash
# build the package once at the repo root: bun run build
bun install
bun run dev        # → http://localhost:3000/links
```

Then create a link in the panel and open `http://localhost:3000/<slug>`.

In this repository the example is type-checked with the others
(`bun run typecheck:examples`); `next build` is not part of CI.
