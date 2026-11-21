/**
 * Elysia-version-agnostic pieces shared by the 1.x (`./elysia.ts`) and 2.x
 * (`./elysia2.ts`) adapters. Must not import `elysia`: each adapter's types are
 * built against a different major.
 *
 * @module
 */

import type { LinksCore } from "../core.ts";
import { createFetchHandler, type LinksPanelOptions } from "../server/create-fetch-handler.ts";

/** A web-standard fetch handler with `core` + `openapi()` attached. */
export interface ElysiaLinksHandler {
  /** Handle a request (what `Elysia.mount(path, handler)` calls). */
  (request: Request): Promise<Response>;
  /** The underlying core (share it with `linksRedirect({ core })`). */
  core: LinksCore;
  /** The admin API as an OpenAPI 3.1 document (also served at `{basePath}/api/openapi.json`). */
  openapi(): Record<string, unknown>;
}

/** Create a panel handler suitable for `Elysia.mount(path, handler)`. */
export function linksPanel(options: LinksPanelOptions): ElysiaLinksHandler {
  const handler = createFetchHandler(options);
  const fn = ((request: Request) => handler.fetch(request)) as ElysiaLinksHandler;
  fn.core = handler.core;
  fn.openapi = handler.openapi;
  return fn;
}

/** Options for `linksElysia`. */
export interface LinksElysiaOptions extends LinksPanelOptions {
  /** Mount prefix; also used as the panel basePath. Default `"/links"`. */
  prefix?: string;
}

/**
 * Build the handler every declared route delegates to. Elysia parses the body
 * for declared routes, draining the stream; rebuild the Request from the parsed
 * body before delegating (mirrors the Express adapter). String bodies (CSV
 * imports) pass through verbatim.
 */
export function createPass(options: LinksElysiaOptions): {
  prefix: string;
  core: LinksCore;
  pass: (ctx: { request: Request; body?: unknown }) => Promise<Response>;
} {
  const prefix = options.prefix ?? "/links";
  const handler = createFetchHandler({ ...options, basePath: options.basePath ?? prefix });

  const pass = (ctx: { request: Request; body?: unknown }): Promise<Response> => {
    const r = ctx.request;
    if (ctx.body != null && ["POST", "PUT", "PATCH", "DELETE"].includes(r.method)) {
      return handler.fetch(
        new Request(r.url, {
          method: r.method,
          headers: r.headers,
          body: typeof ctx.body === "string" ? ctx.body : JSON.stringify(ctx.body),
        }),
      );
    }
    return handler.fetch(r);
  };

  return { prefix, core: handler.core, pass };
}

export type { LinksPanelOptions };
