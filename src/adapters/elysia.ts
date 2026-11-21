/**
 * Elysia adapter (1.x). Three pieces:
 *
 * 1. {@link linksPanel} — a web-standard handler for `Elysia.mount(path, handler)`.
 *    Simplest, but opaque to Eden (the typed client can't see the routes).
 *
 *    ```ts
 *    new Elysia().mount("/links", linksPanel({ basePath: "/links", storage }));
 *    ```
 *
 * 2. {@link linksElysia} — a typed Elysia plugin that *declares* the admin routes,
 *    so **Eden treaty** (`@elysiajs/eden`) infers them:
 *    `client.links.api.tenants({ tenant: "acme" }).links.get()`, etc.
 *    Each handler delegates to the same pipeline (auth/validation/logic reused).
 *
 * 3. {@link linksRedirect} — a plugin answering short links in `onRequest`
 *    (before routing); everything else falls through to your routes.
 *
 *    ```ts
 *    const app = new Elysia()
 *      .use(linksElysia({ prefix: "/links", storage }))
 *      .use(linksRedirect({ storage }));
 *    ```
 *
 * @module
 */

import { Elysia, t } from "elysia";
import type { RedirectHandler } from "../redirect.ts";
import {
  createPass,
  linksPanel,
  type ElysiaLinksHandler,
  type LinksElysiaOptions,
  type LinksPanelOptions,
} from "./elysia-shared.ts";
import { toRedirectHandler, type LinksRedirectInput } from "./redirect-shared.ts";

export { linksPanel };
export type { ElysiaLinksHandler, LinksElysiaOptions, LinksPanelOptions, LinksRedirectInput };

const tenantParams = t.Object({ tenant: t.String() });
const linkParams = t.Object({ tenant: t.String(), id: t.String() });
const hostParams = t.Object({ hostname: t.String() });

/**
 * The typed plugin {@link linksElysia} returns: an `Elysia` instance whose
 * route table (every admin route with its params and body schema) is what Eden
 * treaty infers from `typeof app`.
 */
export type LinksElysiaPlugin = ReturnType<typeof linksElysiaRoutes>;

/**
 * Typed Elysia plugin exposing the admin API so the **Eden** client can call it
 * with full path/method/param typing. Routes are declared for the typed
 * surface; every handler delegates to the shared fetch pipeline (auth,
 * authorization, viewer scoping, error mapping reused). A catch-all also
 * serves the bundled UI. The panel's core is on `plugin.decorator.linksCore`.
 *
 * Elysia 1.x only — for Elysia 2 import from `@xtandard/links/elysia2`.
 */
export function linksElysia(options: LinksElysiaOptions): LinksElysiaPlugin {
  return linksElysiaRoutes(options);
}

/**
 * The route declarations behind {@link linksElysia}; its inferred type is
 * {@link LinksElysiaPlugin}.
 *
 * @internal
 */
function linksElysiaRoutes(options: LinksElysiaOptions) {
  const { prefix, core, pass } = createPass(options);

  const tenant = "/api/tenants/:tenant";
  const link = `${tenant}/links/:id`;

  return new Elysia({ prefix, name: "xtandard-links", seed: prefix })
    .decorate("linksCore", core)
    .get("/config", pass)
    .get("/healthcheck", pass)
    .get("/api/openapi.json", pass)
    .get("/api/tenants", pass)
    .get(tenant, pass, { params: tenantParams })
    .put(tenant, pass, {
      params: tenantParams,
      body: t.Object({ name: t.Optional(t.String()), metadata: t.Optional(t.Any()) }),
    })
    .delete(tenant, pass, { params: tenantParams })
    .get("/api/domains", pass)
    .post("/api/domains", pass, {
      body: t.Object({ hostname: t.String() }, { additionalProperties: true }),
    })
    .get("/api/domains/:hostname", pass, { params: hostParams })
    .put("/api/domains/:hostname", pass, { params: hostParams, body: t.Any() })
    .delete("/api/domains/:hostname", pass, { params: hostParams })
    .get(`${tenant}/links`, pass, { params: tenantParams })
    .post(`${tenant}/links`, pass, {
      params: tenantParams,
      body: t.Object(
        {
          url: t.String(),
          slug: t.Optional(t.String()),
          domain: t.Optional(t.String()),
          title: t.Optional(t.Union([t.String(), t.Null()])),
          description: t.Optional(t.Union([t.String(), t.Null()])),
          tags: t.Optional(t.Array(t.String())),
          externalId: t.Optional(t.Union([t.String(), t.Null()])),
          expiresAt: t.Optional(t.Union([t.String(), t.Null()])),
          password: t.Optional(t.Union([t.String(), t.Null()])),
        },
        { additionalProperties: true },
      ),
    })
    .get(`${tenant}/links.csv`, pass, { params: tenantParams })
    .post(`${tenant}/links/import`, pass, { params: tenantParams, body: t.Any() })
    .get(link, pass, { params: linkParams })
    .patch(link, pass, { params: linkParams, body: t.Any() })
    .delete(link, pass, { params: linkParams })
    .get(`${link}/qr.svg`, pass, { params: linkParams })
    .get(`${tenant}/tags`, pass, { params: tenantParams })
    .get(`${tenant}/customers`, pass, { params: tenantParams })
    .get(`${tenant}/audit`, pass, { params: tenantParams })
    .get("/api/audit", pass)
    .get(`${tenant}/analytics`, pass, { params: tenantParams })
    .get(`${tenant}/events`, pass, { params: tenantParams })
    .post("/api/track/lead", pass, {
      body: t.Object({ customerId: t.String() }, { additionalProperties: true }),
    })
    .post("/api/track/sale", pass, {
      body: t.Object(
        { customerId: t.String(), amount: t.Number() },
        { additionalProperties: true },
      ),
    })
    .post(`${tenant}/viewer-tokens`, pass, {
      params: tenantParams,
      body: t.Object({
        links: t.Optional(t.Array(t.String())),
        allow: t.Optional(t.Array(t.String())),
        expiresIn: t.Optional(t.Union([t.String(), t.Number()])),
      }),
    })
    .all("/*", pass); // bundled UI assets + SPA fallback
}

/**
 * Plugin answering short links before routing (`onRequest`); requests that are
 * not short links continue to your routes. `handler` is the underlying
 * redirect handler (`core`, `close()`, …).
 *
 * Elysia 1.x only — for Elysia 2 import from `@xtandard/links/elysia2`.
 */
export function linksRedirect(options: LinksRedirectInput) {
  const handler: RedirectHandler = toRedirectHandler(options);
  const plugin = new Elysia().onRequest(async ({ request }) => {
    const response = await handler.handle(request);
    if (response) return response;
  });
  return Object.assign(plugin, { handler });
}
