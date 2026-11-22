/**
 * `@xtandard/links/drizzle/sqlite` — SQLite Drizzle table factory for the
 * links KV store. Schema-only (imports just `drizzle-orm/sqlite-core`).
 *
 * Base columns: `key text PRIMARY KEY`, `value text NOT NULL` in JSON mode
 * (Drizzle serializes/parses transparently). `extraColumns`/`extraIndexes`
 * mirror `drizzle-audit`.
 *
 * @example
 * ```ts
 * import { sqliteLinksTable } from "@xtandard/links/drizzle/sqlite";
 * export const linksKv = sqliteLinksTable();
 * ```
 *
 * @module
 */

import { sqliteKvTable, type SqliteKvTableOptions } from "@xtandard/kit/drizzle/sqlite";
import type { DrizzleKvTable } from "@xtandard/kit/drizzle/sqlite";

export type { DrizzleKvTable } from "@xtandard/kit/drizzle/sqlite";

/** Options for {@link sqliteLinksTable}: `extraColumns` and `extraIndexes`. */
export type SqliteLinksTableOptions = SqliteKvTableOptions;

/**
 * Build the Drizzle `sqliteTable` for the links KV store: `key text PRIMARY
 * KEY`, `value text NOT NULL` (JSON mode). The table name defaults to
 * `"xtandard_links_kv"`.
 */
export function sqliteLinksTable(
  name = "xtandard_links_kv",
  opts?: SqliteLinksTableOptions,
): DrizzleKvTable {
  return sqliteKvTable(name, opts);
}
