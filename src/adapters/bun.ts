/**
 * Bun adapter. Both handlers are web-standard, so these are thin
 * passthroughs for `Bun.serve({ fetch })`:
 *
 * ```ts
 * import { linksPanel, linksRedirect } from "@xtandard/links/bun";
 *
 * const panel = linksPanel({ storage, basePath: "/links" });
 * const redirects = linksRedirect({ core: panel.core, fallback: app.fetch });
 * Bun.serve({
 *   port: 3000,
 *   // Route the panel first: on a registered short domain, unknown slugs get
 *   // the redirect handler's 404 page rather than falling through.
 *   fetch: (req) =>
 *     new URL(req.url).pathname.startsWith("/links") ? panel.fetch(req) : redirects.fetch(req),
 * });
 * ```
 *
 * @module
 */

import type { RedirectContext, RedirectHandler } from "../redirect.ts";
import {
  createFetchHandler,
  type CreateFetchHandlerResult,
  type LinksPanelOptions,
} from "../server/create-fetch-handler.ts";
import { toRedirectHandler, type LinksRedirectInput } from "./redirect-shared.ts";

/** Create a Bun-ready panel handler (`fetch` + `core` + `openapi`). */
export function linksPanel(options: LinksPanelOptions): CreateFetchHandlerResult {
  return createFetchHandler(options);
}

/** What `Bun.serve` passes as the second `fetch` argument (kept structural: no `bun` types needed). */
export type BunServerLike = unknown;

/** Options for {@link linksRedirect}. */
export type BunLinksRedirectOptions = LinksRedirectInput & {
  /**
   * Called when a request is not a short link (`handle()` returned `null`:
   * an unregistered host, a reserved path, …) — usually your app. Default: the
   * redirect handler's 404 page. Unknown slugs on a registered short domain
   * get the 404 page (or the domain's `notFoundUrl`), not the fallback.
   */
  fallback?: (request: Request, server?: BunServerLike) => Response | Promise<Response>;
};

/** The Bun redirect handler. */
export interface BunLinksRedirect {
  /** Short link → redirect; anything else → `fallback` (or a 404 page). */
  fetch(request: Request, server?: BunServerLike): Promise<Response>;
  /** The raw `handle()`: a `Response`, or `null` when the request is not a short link. */
  handle(request: Request, ctx?: RedirectContext): Promise<Response | null>;
  /** The underlying redirect handler (`core`, `resolver`, `ingestor`, `close()`). */
  handler: RedirectHandler;
}

/** Create a redirect handler for `Bun.serve`, falling through to `fallback`. */
export function linksRedirect(options: BunLinksRedirectOptions): BunLinksRedirect {
  const { fallback, ...rest } = options;
  const prebuilt = "handle" in options && "resolver" in options;
  const handler = toRedirectHandler((prebuilt ? options : rest) as LinksRedirectInput);
  return {
    handler,
    handle: (request, ctx) => handler.handle(request, ctx),
    async fetch(request, server) {
      const response = await handler.handle(request);
      if (response) return response;
      return fallback ? fallback(request, server) : handler.fetch(request);
    },
  };
}

export type { LinksPanelOptions, CreateFetchHandlerResult };
