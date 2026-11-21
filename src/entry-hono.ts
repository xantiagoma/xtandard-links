/**
 * Hono adapter: `linksPanel()` returns a Hono sub-app serving the panel (to
 * compose with `app.route(path, panel)`), and `linksRedirect()` is middleware
 * answering short links and calling `next()` for everything else.
 *
 * Import from `@xtandard/links/hono`.
 *
 * @module hono
 */

export * from "./adapters/hono.ts";
