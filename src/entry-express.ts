/**
 * Express adapter: `linksPanel()` bridges Node's `req`/`res` to the
 * web-standard panel handler, and `linksRedirect()` is middleware answering
 * short links and calling `next()` for everything else.
 *
 * Import from `@xtandard/links/express`.
 *
 * @module express
 */

export * from "./adapters/express.ts";
