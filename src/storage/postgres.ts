/**
 * Postgres storage adapter backed by a single key/value table
 * (`key text PRIMARY KEY, value jsonb`). It works with any client exposing a
 * `query(text, params?)` method that resolves to `{ rows }` — this covers
 * [`pg`](https://github.com/brianc/node-postgres) (`Pool`/`Client`) and the
 * in-process [`@electric-sql/pglite`](https://github.com/electric-sql/pglite)
 * alike. You can pass a pre-built `client`, or a `connectionString`/`url` to
 * lazily create a `pg` `Pool` on first use.
 *
 * The driver is `@xtandard/kit/storage/postgres`. The table is created on
 * demand (`CREATE TABLE IF NOT EXISTS`) the first time any operation runs; a
 * failed DDL is retried on the next call. The table name defaults to
 * `"xtandard_links_kv"`, as in every earlier release.
 *
 * Implements {@link CompareAndSwapLinksStorage}: claiming an absent key is an
 * `INSERT … ON CONFLICT DO NOTHING`, and a swap is a single conditional
 * `UPDATE … WHERE value = $expected::jsonb` — both atomic in one statement, so
 * concurrent slug claims across processes have exactly one winner.
 *
 * @module
 */

import * as kit from "@xtandard/kit/storage/postgres";

export type { SqlClient } from "@xtandard/kit/storage/postgres";

/** Options for {@link createPostgresStorage}. `table` defaults to `"xtandard_links_kv"`. */
export type PostgresStorageOptions = kit.PostgresStorageOptions;

/**
 * A {@link CompareAndSwapLinksStorage} backed by Postgres, plus a `close()` method that
 * ends the underlying pool — but only the one this adapter created. A client
 * you passed in is left for you to manage.
 */
export type PostgresLinksStorage = kit.PostgresKvStorage;

/**
 * Create a Postgres-backed {@link PostgresLinksStorage}. The table is created
 * lazily on first use; connection (when using `connectionString`/`url`) is also
 * lazy.
 *
 * @example
 * ```ts
 * import { createPostgresStorage } from "@xtandard/links/storage/postgres";
 *
 * // Via connection string (lazy `pg` Pool):
 * const storage = createPostgresStorage({
 *   connectionString: process.env.DATABASE_URL,
 * });
 *
 * // Or with a pre-built pg Pool / PGlite client:
 * // import { PGlite } from "@electric-sql/pglite";
 * // const storage = createPostgresStorage({ client: new PGlite() });
 * ```
 */
export function createPostgresStorage(options: PostgresStorageOptions = {}): PostgresLinksStorage {
  return kit.createPostgresStorage({
    subpath: "@xtandard/links/storage/postgres",
    ...options,
    table: options.table ?? "xtandard_links_kv",
  });
}
