/**
 * Elysia + @xtandard/links — the typed admin plugin (Eden-ready) and the
 * redirect plane.
 *
 *   bun add elysia @xtandard/links
 *   bun run src/index.ts       # the server
 *   bun run src/demo.ts        # an Eden treaty client calling the typed admin API
 *
 * Then:
 *   - GET /links       → the admin panel + JSON API (typed for Eden).
 *   - GET /docs        → a short link → redirect.
 *   - GET /            → your own route.
 */
import { Elysia } from "elysia";
import { DEFAULT_RESERVED_SLUGS } from "@xtandard/links";
import { linksElysia, linksRedirect } from "@xtandard/links/elysia";
import { createFileStorage } from "@xtandard/links/storage/file";

const port = Number(process.env.PORT) || 3000;

// `linksElysia` declares every admin route with its params + body schema, so
// `typeof app` carries them and Eden treaty infers a typed client.
const admin = linksElysia({
  prefix: "/links",
  storage: createFileStorage({ dir: "./.links" }),
  title: "Acme Links",
  defaultDomain: "localhost",
  // `linksRedirect` runs in onRequest, before routing, so it sees /links/* too.
  // Reserving the panel's first segment keeps those lookups out of the resolver.
  coreOptions: { reservedSlugs: [...DEFAULT_RESERVED_SLUGS, "links"] },
});
const core = admin.decorator.linksCore;

if ((await core.listLinks("default", { limit: 1 })).total === 0) {
  await core.createLink({
    slug: "docs",
    url: "https://me.xantiagoma.com/xtandard-links/",
    title: "Documentation",
  });
}

const app = new Elysia()
  .use(admin)
  // Short links answered in onRequest; everything else reaches the routes.
  .use(linksRedirect({ core }))
  .get("/", () => "Acme home — try /docs, or open /links")
  .listen(port);

/** The app's type: `treaty<App>(…)` gives a fully typed admin client (see demo.ts). */
export type App = typeof app;

console.log(`Elysia listening on http://localhost:${port} (panel at /links, try /docs)`);
