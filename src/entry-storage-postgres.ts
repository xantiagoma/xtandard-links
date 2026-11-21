/**
 * Postgres storage: `createPostgresStorage()` keeps a single `jsonb` key/value
 * table, created on first use, with atomic compare-and-swap. Works with `pg`
 * or PGlite.
 *
 * Import from `@xtandard/links/storage/postgres`.
 *
 * @module storage/postgres
 */

export * from "./storage/postgres.ts";
