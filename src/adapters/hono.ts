/**
 * Hono adapter.
 *
 * - {@link linksPanel} returns a `Hono` sub-app whose catch-all delegates to the
 *   web-standard panel handler, so it composes via `app.route(path, panel)`.
 * - {@link linksRedirect} is middleware: short links are answered, everything
 *   else continues to your routes (`next()`). On Workers it passes
 *   `c.executionCtx.waitUntil` so click recording outlives the response.
 *
 * ```ts
 * import { linksPanel, linksRedirect } from "@xtandard/links/hono";
 *
 * const panel = linksPanel({ storage, basePath: "/links" });
 * app.route("/links", panel); // first: handlers run in registration order
 * app.use(linksRedirect({ core: panel.core }));
 * ```
 *
 * @module
 */

import { Hono, type MiddlewareHandler } from "hono";
import type { RedirectContext, RedirectHandler } from "../redirect.ts";
import { createFetchHandler, type LinksPanelOptions } from "../server/create-fetch-handler.ts";
import { toRedirectHandler, type LinksRedirectInput } from "./redirect-shared.ts";

/**
 * Create a Hono sub-app serving the panel. The admin `core` and the
 * `openapi()` document builder are attached.
 */
export function linksPanel(options: LinksPanelOptions): Hono & {
  core: ReturnType<typeof createFetchHandler>["core"];
  openapi: ReturnType<typeof createFetchHandler>["openapi"];
} {
  const handler = createFetchHandler(options);
  const app = new Hono();
  app.all("*", (c) => handler.fetch(c.req.raw));
  return Object.assign(app, { core: handler.core, openapi: handler.openapi });
}

/** The redirect middleware, with the underlying handler attached. */
export type HonoLinksRedirect = MiddlewareHandler & { handler: RedirectHandler };

/** `c.executionCtx` throws outside Workers-style runtimes; read it defensively. */
function waitUntilOf(c: { executionCtx: unknown }): RedirectContext | undefined {
  try {
    const ctx = c.executionCtx as { waitUntil?: (p: Promise<unknown>) => void } | undefined;
    if (ctx && typeof ctx.waitUntil === "function") {
      return { waitUntil: (p) => ctx.waitUntil?.(p) };
    }
  } catch {
    // no ExecutionContext (Bun/Node)
  }
  return undefined;
}

/** Middleware answering short links and calling `next()` for everything else. */
export function linksRedirect(options: LinksRedirectInput): HonoLinksRedirect {
  const handler = toRedirectHandler(options);
  const middleware: MiddlewareHandler = async (c, next) => {
    const response = await handler.handle(c.req.raw, waitUntilOf(c));
    if (response) return response;
    await next();
  };
  return Object.assign(middleware, { handler });
}

export type { LinksPanelOptions, LinksRedirectInput };
