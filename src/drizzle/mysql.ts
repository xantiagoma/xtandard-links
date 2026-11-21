/**
 * `@xtandard/links/drizzle/mysql` — MySQL Drizzle table factory for the
 * links KV store. Schema-only (imports just `drizzle-orm/mysql-core`).
 *
 * Base columns: `key varchar … COLLATE utf8mb4_bin PRIMARY KEY` (length configurable), `value json
 * NOT NULL`. `extraColumns`/`extraIndexes` mirror `drizzle-audit`.
 *
 * The `key` column uses the **`utf8mb4_bin`** collation: MySQL's default
 * (`utf8mb4_0900_ai_ci`) is case- and accent-insensitive, so keys such as
 * `lnk/t/Acme/…` and `lnk/t/acme/…` would be the same primary key. New tables
 * can opt into a NO PAD collation with `keyCollation` (docs/STORAGE.md).
 *
 * @example
 * ```ts
 * import { mysqlLinksTable } from "@xtandard/links/drizzle/mysql";
 * export const linksKv = mysqlLinksTable();
 * ```
 *
 * @module
 */

import { mysqlKvTable, type MysqlKvTableOptions } from "@xtandard/kit/drizzle/mysql";
import type { DrizzleKvTable } from "@xtandard/kit/drizzle/mysql";

export type { DrizzleKvTable } from "@xtandard/kit/drizzle/mysql";

/**
 * Options for {@link mysqlLinksTable}: `keyLength` (default `512`; keep within
 * your InnoDB index-prefix limit), `keyCollation` (default `utf8mb4_bin`; opt
 * into `utf8mb4_0900_bin` / `utf8mb4_nopad_bin` for new tables),
 * `extraColumns` and `extraIndexes`.
 */
export type MysqlLinksTableOptions = MysqlKvTableOptions;

/**
 * Build the MySQL `mysqlTable` for the links KV store: `key varchar PRIMARY
 * KEY` (`utf8mb4_bin`), `value json NOT NULL`. The table name defaults to
 * `"xtandard_links_kv"`.
 */
export function mysqlLinksTable(
  name = "xtandard_links_kv",
  opts?: MysqlLinksTableOptions,
): DrizzleKvTable {
  return mysqlKvTable(name, opts);
}
