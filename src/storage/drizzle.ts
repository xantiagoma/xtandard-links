/**
 * Drizzle storage adapter — a {@link LinksStorage} over a **consumer-owned**
 * Drizzle table and database. Unlike {@link ./postgres.createPostgresStorage} it
 * issues **no DDL** (the table lives in your Drizzle schema + migrations) and
 * **owns no connection** (it reuses the `db` you pass, and never closes it).
 *
 * Dialect-agnostic: works with Postgres, MySQL, and SQLite Drizzle databases.
 * Build the backing table with the matching factory —
 * {@link ../drizzle/pg.pgLinksTable} / {@link ../drizzle/mysql.mysqlLinksTable} /
 * {@link ../drizzle/sqlite.sqliteLinksTable} — whose fixed `key`/`value`
 * columns this adapter reads and writes. The driver is
 * `@xtandard/kit/storage/drizzle`.
 *
 * @example
 * ```ts
 * import { drizzle } from "drizzle-orm/node-postgres";
 * import { createDrizzleStorage } from "@xtandard/links/storage/drizzle";
 * import { pgLinksTable } from "@xtandard/links/drizzle/pg";
 *
 * export const linksKv = pgLinksTable(); // add to your schema + migrate
 * const db = drizzle(pool);              // your existing pool
 * const storage = createDrizzleStorage({ db, table: linksKv });
 * ```
 *
 * ## Compare-and-swap
 *
 * Every dialect implements {@link CompareAndSwapLinksStorage} (so slug claims
 * are race-free across processes), MySQL included. On MySQL a write whose key
 * differs from a stored one only by trailing spaces throws `KeyCollisionError`
 * (`utf8mb4_bin` is a PAD SPACE collation); links keys never end in a space,
 * because every variable segment is URI-encoded.
 *
 * @module
 */

import * as kit from "@xtandard/kit/storage/drizzle";

export {
  KeyCollisionError,
  type DrizzleKvStorage as DrizzleLinksStorage,
  type DrizzleKvTable,
  type DrizzleStorageOptions,
} from "@xtandard/kit/storage/drizzle";

/** Create a Drizzle-backed storage over your `db` and a `*LinksTable` table. No DDL. */
export function createDrizzleStorage(options: kit.DrizzleStorageOptions): kit.DrizzleKvStorage {
  return kit.createDrizzleStorage({ subpath: "@xtandard/links/storage/drizzle", ...options });
}
