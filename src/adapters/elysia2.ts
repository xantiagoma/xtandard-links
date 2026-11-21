/**
 * Elysia **2.x** adapter — same surface as `@xtandard/links/elysia`, built against Elysia 2's types and its `(path, hook, handler)` route order. Three pieces:
 *
 * 1. {@link linksPanel} — a web-standard handler for `Elysia.mount(path, handler)`.
 *    Simplest, but opaque to Eden (the typed client can't see the routes).
 *
 *    ```ts
 *    new Elysia().mount("/links", linksPanel({ basePath: "/links", storage }));
 *    ```
 *
 * 2. {@link linksElysia} — a typed Elysia plugin that *declares* the admin routes,
 *    so **Eden treaty** (`@elysia/eden`) infers them:
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
 * Elysia 2.x only — for Elysia 1.x import from `@xtandard/links/elysia`.
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
    .get(tenant, { params: tenantParams }, pass)
    .put(
      tenant,
      {
        params: tenantParams,
        body: t.Object({ name: t.Optional(t.String()), metadata: t.Optional(t.Any()) }),
      },
      pass,
    )
    .delete(tenant, { params: tenantParams }, pass)
    .get("/api/domains", pass)
    .post(
      "/api/domains",
      {
        body: t.Object({ hostname: t.String() }, { additionalProperties: true }),
      },
      pass,
    )
    .get("/api/domains/:hostname", { params: hostParams }, pass)
    .put("/api/domains/:hostname", { params: hostParams, body: t.Any() }, pass)
    .delete("/api/domains/:hostname", { params: hostParams }, pass)
    .get(`${tenant}/links`, { params: tenantParams }, pass)
    .post(
      `${tenant}/links`,
      {
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
      },
      pass,
    )
    .get(`${tenant}/links.csv`, { params: tenantParams }, pass)
    .post(`${tenant}/links/import`, { params: tenantParams, body: t.Any() }, pass)
    .get(link, { params: linkParams }, pass)
    .patch(link, { params: linkParams, body: t.Any() }, pass)
    .delete(link, { params: linkParams }, pass)
    .get(`${link}/qr.svg`, { params: linkParams }, pass)
    .get(`${tenant}/tags`, { params: tenantParams }, pass)
    .get(`${tenant}/customers`, { params: tenantParams }, pass)
    .get(`${tenant}/audit`, { params: tenantParams }, pass)
    .get("/api/audit", pass)
    .get(`${tenant}/analytics`, { params: tenantParams }, pass)
    .get(`${tenant}/events`, { params: tenantParams }, pass)
    .post(
      "/api/track/lead",
      {
        body: t.Object({ customerId: t.String() }, { additionalProperties: true }),
      },
      pass,
    )
    .post(
      "/api/track/sale",
      {
        body: t.Object(
          { customerId: t.String(), amount: t.Number() },
          { additionalProperties: true },
        ),
      },
      pass,
    )
    .post(
      `${tenant}/viewer-tokens`,
      {
        params: tenantParams,
        body: t.Object({
          links: t.Optional(t.Array(t.String())),
          allow: t.Optional(t.Array(t.String())),
          expiresIn: t.Optional(t.Union([t.String(), t.Number()])),
        }),
      },
      pass,
    )
    .all("/*", pass); // bundled UI assets + SPA fallback
}

/**
 * Plugin answering short links before routing (`onRequest`); requests that are
 * not short links continue to your routes. `handler` is the underlying
 * redirect handler (`core`, `close()`, …).
 *
 * Elysia 2.x only — for Elysia 1.x import from `@xtandard/links/elysia`.
 */
export function linksRedirect(options: LinksRedirectInput) {
  const handler: RedirectHandler = toRedirectHandler(options);
  const plugin = new Elysia().onRequest(async ({ request }) => {
    const response = await handler.handle(request);
    if (response) return response;
  });
  return Object.assign(plugin, { handler });
}
