/**
 * Next.js adapter — web-standard only (no `next` import), so it works with
 * any Next version and on the Edge runtime for the redirect side.
 *
 * - {@link linksRouteHandlers}: the admin panel for an app-router catch-all,
 *   `app/links/[[...path]]/route.ts`:
 *
 *   ```ts
 *   import { linksRouteHandlers } from "@xtandard/links/next";
 *   export const { GET, POST, PUT, PATCH, DELETE, OPTIONS } = linksRouteHandlers({
 *     storage, basePath: "/links",
 *   });
 *   ```
 *
 * - {@link linksMiddleware}: the redirect plane in `middleware.ts`. It resolves
 *   to a `Response` for short links and `undefined` to continue:
 *
 *   ```ts
 *   import { linksMiddleware } from "@xtandard/links/next";
 *   const redirects = linksMiddleware({ storage, defaultDomain: "go.acme.com" });
 *   export default async function middleware(request: Request, event: { waitUntil(p: Promise<unknown>): void }) {
 *     return (await redirects(request, event)) ?? undefined; // NextResponse.next() equivalent
 *   }
 *   ```
 *
 * @module
 */

import { toNextHandler } from "@xtandard/kit/adapters/next";
import type { RedirectHandler } from "../redirect.ts";
import {
  createFetchHandler,
  type CreateFetchHandlerResult,
  type LinksPanelOptions,
} from "../server/create-fetch-handler.ts";
import { toRedirectHandler, type LinksRedirectInput } from "./redirect-shared.ts";

/** An app-router route handler. */
export type NextRouteHandler = (request: Request, context?: unknown) => Promise<Response>;

/** Route handlers for every method, plus the panel's `core` and `openapi`. */
export interface LinksRouteHandlers {
  GET: NextRouteHandler;
  HEAD: NextRouteHandler;
  POST: NextRouteHandler;
  PUT: NextRouteHandler;
  PATCH: NextRouteHandler;
  DELETE: NextRouteHandler;
  OPTIONS: NextRouteHandler;
  core: CreateFetchHandlerResult["core"];
  openapi: CreateFetchHandlerResult["openapi"];
  close: CreateFetchHandlerResult["close"];
}

/** Create the panel (`createFetchHandler`); same as the other adapters' `linksPanel`. */
export function linksPanel(options: LinksPanelOptions): CreateFetchHandlerResult {
  return createFetchHandler(options);
}

/** App-router route handlers serving the panel from a catch-all route. */
export function linksRouteHandlers(options: LinksPanelOptions): LinksRouteHandlers {
  const panel = createFetchHandler(options);
  return { ...toNextHandler(panel), core: panel.core, openapi: panel.openapi, close: panel.close };
}

/** The `event` Next passes to middleware (structural; only `waitUntil` is used). */
export interface NextFetchEventLike {
  waitUntil?(promise: Promise<unknown>): void;
}

/** Middleware: a `Response` for short links, `undefined` to continue. */
export type NextLinksMiddleware = ((
  request: Request,
  event?: NextFetchEventLike,
) => Promise<Response | undefined>) & { handler: RedirectHandler };

/** Create the redirect middleware. */
export function linksMiddleware(options: LinksRedirectInput): NextLinksMiddleware {
  const handler = toRedirectHandler(options);
  const middleware = async (request: Request, event?: NextFetchEventLike) => {
    const waitUntil = event?.waitUntil;
    const response = await handler.handle(
      request,
      waitUntil ? { waitUntil: (p) => waitUntil.call(event, p) } : undefined,
    );
    return response ?? undefined;
  };
  return Object.assign(middleware, { handler });
}

/** Alias of {@link linksMiddleware}, matching the other adapters' naming. */
export const linksRedirect: (options: LinksRedirectInput) => NextLinksMiddleware = linksMiddleware;

export type { LinksPanelOptions, LinksRedirectInput };
