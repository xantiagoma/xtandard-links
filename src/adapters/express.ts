/**
 * Express adapter. Express predates the web Fetch API, so this bridges Node's
 * `req`/`res` to the web-standard handlers. No `express` import at runtime —
 * only its types.
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
};

/** The redirect middleware, with the underlying handler attached. */
export type ExpressLinksRedirect = ((
  req: ExRequest,
  res: ExResponse,
  next: NextFunction,
) => void) & {
  handler: RedirectHandler;
};

function headersFrom(req: ExRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else headers.set(key, value);
  }
  return headers;
}

/** A previously parsed body (`express.json()` / `express.urlencoded()`), re-serialized. */
function parsedBody(req: ExRequest): Uint8Array | undefined {
  const body = (req as { body?: unknown }).body;
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  const type = String(req.headers["content-type"] ?? "");
  const text = type.includes("application/x-www-form-urlencoded")
    ? new URLSearchParams(body as Record<string, string>).toString()
    : JSON.stringify(body);
  return new TextEncoder().encode(text);
}

async function readBody(req: ExRequest): Promise<Uint8Array | undefined> {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return undefined;
  if (req.readableEnded) return parsedBody(req);
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) chunks.push(chunk);
  return chunks.length ? new Uint8Array(Buffer.concat(chunks)) : undefined;
}

/** A body stream that only pulls from `req` when someone reads it. */
function lazyBody(req: ExRequest): ReadableStream<Uint8Array> {
  let iterator: AsyncIterator<Buffer> | undefined;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        iterator ??= (req as AsyncIterable<Buffer>)[Symbol.asyncIterator]();
        const { value, done } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(new Uint8Array(value));
      },
    },
    { highWaterMark: 0 },
  );
}

function requestUrl(req: ExRequest): string {
  const protocol = req.protocol || "http";
  const host = req.get?.("host") ?? req.headers.host ?? "localhost";
  // originalUrl preserves the mount prefix (e.g. /links/api/...) and query string.
  return `${protocol}://${host}${req.originalUrl ?? req.url ?? "/"}`;
}

function toWebRequest(req: ExRequest, body: BodyInit | undefined): Request {
  return new Request(requestUrl(req), {
    method: req.method,
    headers: headersFrom(req),
    body,
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  } as RequestInit);
}

async function writeWebResponse(res: ExResponse, response: Response): Promise<void> {
  res.status(response.status);
  const cookies = response.headers.getSetCookie?.() ?? [];
  response.headers.forEach((value, key) => {
    if (key !== "set-cookie") res.setHeader(key, value);
  });
  if (cookies.length) res.setHeader("set-cookie", cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}

/** Create an Express handler serving the panel. Use with `app.use(path, handler)`. */
export function linksPanel(options: LinksPanelOptions): ExpressLinksHandler {
  const handler = createFetchHandler(options);
  const middleware = (req: ExRequest, res: ExResponse, next: NextFunction): void => {
    (async () => {
      const body = await readBody(req);
      const response = await handler.fetch(toWebRequest(req, body as BodyInit | undefined));
      await writeWebResponse(res, response);
    })().catch(next);
  };
  return Object.assign(middleware, { core: handler.core, openapi: handler.openapi });
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
      let body: BodyInit | undefined;
      if (method === "POST") {
        body = req.readableEnded
          ? (parsedBody(req) as BodyInit | undefined)
          : (lazyBody(req) as BodyInit);
      }
      const response = await handler.handle(toWebRequest(req, body));
      if (!response) {
        next();
        return;
      }
      await writeWebResponse(res, response);
    })().catch(next);
  };
  return Object.assign(middleware, { handler });
}

export type { LinksPanelOptions, LinksRedirectInput };
