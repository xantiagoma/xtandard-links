/**
 * Express adapter. Express predates the web Fetch API, so this bridges Node's
 * `req`/`res` to the web-standard handlers through `@xtandard/kit/adapters/node`
 * (every `Set-Cookie` kept, multi-value headers appended, responses streamed).
 * No `express` import at runtime — only its types.
 *
 * - {@link linksPanel}: mount the admin panel. Mount it BEFORE any
 *   body-parser middleware (it reads the raw request body), or after — a body
 *   already parsed by `express.json()` is re-serialized.
 * - {@link linksRedirect}: middleware answering short links and calling
 *   `next()` for everything else. The request body is only read when the
 *   redirect handler needs it (a password form POST for one of its links), so
 *   your own body parsers still see untouched streams.
 *
 * ```ts
 * import express from "express";
 * import { linksPanel, linksRedirect } from "@xtandard/links/express";
 *
 * const app = express();
 * const panel = linksPanel({ basePath: "/links", storage });
 * app.use("/links", panel);
 * app.use(linksRedirect({ core: panel.core }));
 * ```
 *
 * @module
 */

import type { NextFunction, Request as ExRequest, Response as ExResponse } from "express";
import { toExpressMiddleware } from "@xtandard/kit/adapters/express";
import { toWebRequest, writeWebResponse } from "@xtandard/kit/adapters/node";
import type { RedirectHandler } from "../redirect.ts";
import { createFetchHandler, type LinksPanelOptions } from "../server/create-fetch-handler.ts";
import { toRedirectHandler, type LinksRedirectInput } from "./redirect-shared.ts";

/** An Express request handler with the admin `core` + `openapi` attached. */
export type ExpressLinksHandler = ((
  req: ExRequest,
  res: ExResponse,
  next: NextFunction,
) => void) & {
  core: ReturnType<typeof createFetchHandler>["core"];
  openapi: ReturnType<typeof createFetchHandler>["openapi"];
  close: ReturnType<typeof createFetchHandler>["close"];
};

/** The redirect middleware, with the underlying handler attached. */
export type ExpressLinksRedirect = ((
  req: ExRequest,
  res: ExResponse,
  next: NextFunction,
) => void) & {
  handler: RedirectHandler;
};

/** Create an Express handler serving the panel. Use with `app.use(path, handler)`. */
export function linksPanel(options: LinksPanelOptions): ExpressLinksHandler {
  const handler = createFetchHandler(options);
  return Object.assign(toExpressMiddleware(handler.fetch), {
    core: handler.core,
    openapi: handler.openapi,
    close: handler.close,
  });
}

/** Middleware answering short links and calling `next()` for everything else. */
export function linksRedirect(options: LinksRedirectInput): ExpressLinksRedirect {
  const handler = toRedirectHandler(options);
  const middleware = (req: ExRequest, res: ExResponse, next: NextFunction): void => {
    const method = (req.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "POST") {
      next();
      return;
    }
    (async () => {
      // The body is streamed lazily: a POST that is not for a short link reaches
      // the next middleware with its stream untouched.
      const response = await handler.handle(await toWebRequest(req, { lazyBody: true }));
      if (!response) {
        next();
        return;
      }
      await writeWebResponse(res, response, req);
    })().catch(next);
  };
  return Object.assign(middleware, { handler });
}

export type { LinksPanelOptions, LinksRedirectInput };
