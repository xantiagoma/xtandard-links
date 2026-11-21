/**
 * Drizzle storage: `createDrizzleStorage()` reads and writes a table you own
 * (built with the `drizzle/*` factories) through the Drizzle database you
 * pass. No DDL, no connection of its own; Postgres, MySQL or SQLite
 * (compare-and-swap on Postgres and SQLite).
 *
 * Import from `@xtandard/links/storage/drizzle`.
 *
 * @module storage/drizzle
 */

export * from "./storage/drizzle.ts";
