/**
 * The redirect plane: short links are answered here, before routing; anything
 * that is not a short link (unknown slugs, `/`, your pages) continues to the app.
 *
 * On Next 16, `middleware.ts` is renamed `proxy.ts` (export `proxy` instead of a
 * default export); the body is the same.
 */
import { linksMiddleware } from "@xtandard/links/next";
import { defaultDomain, storage } from "./lib/links";

const redirects = linksMiddleware({ storage, defaultDomain });

export default async function middleware(
  request: Request,
  event: { waitUntil(promise: Promise<unknown>): void },
): Promise<Response | undefined> {
  // A Response for short links (redirect, password page, …); undefined = continue.
  // `event.waitUntil` keeps click recording alive after the response.
  return redirects(request, event);
}

export const config = {
  // File storage needs Node APIs; the Node.js middleware runtime is stable since
  // Next 15.5. With an HTTP-based store (Upstash, Vercel KV) drop this line to run
  // on the Edge runtime.
  runtime: "nodejs",
  // Skip Next internals, the panel and static files.
  matcher: ["/((?!_next/|links|favicon.ico).*)"],
};
