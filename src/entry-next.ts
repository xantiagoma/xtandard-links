/**
 * Next.js adapter (web-standard, no `next` import): `linksRouteHandlers()`
 * serves the panel from an app-router catch-all route, and `linksMiddleware()`
 * (alias `linksRedirect()`) answers short links from `middleware.ts`,
 * resolving `undefined` to continue.
 *
 * Import from `@xtandard/links/next`.
 *
 * @module next
 */

export * from "./adapters/next.ts";
