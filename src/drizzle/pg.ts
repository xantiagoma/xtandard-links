/**
 * `@xtandard/links/drizzle/pg` — a Drizzle table factory for the links KV
 * store.
 *
 * Schema-only (imports just `drizzle-orm/pg-core`, never the links core), so
 * it is safe to use inside a Drizzle schema file. The base table is the store's
 * KV shape (`key text PRIMARY KEY`, `value jsonb NOT NULL`); adding it to your
 * schema brings the links table into your normal `drizzle-kit`
 * generate/migrate flow instead of an adapter-side `CREATE TABLE`.
 * `extraColumns`/`extraIndexes` mirror the `drizzle-audit` factories for when
 * you want to extend it.
 *
 * @example
 * ```ts
 * // schema.ts
 * import { pgLinksTable } from "@xtandard/links/drizzle/pg";
 * export const linksKv = pgLinksTable();
 *
 * // then: createDrizzleStorage({ db, table: linksKv })
 * ```
 *
 * @module
 */

import { pgKvTable, type PgKvTableOptions } from "@xtandard/kit/drizzle/pg";
import type { DrizzleKvTable } from "@xtandard/kit/drizzle/pg";

export type { DrizzleKvTable } from "@xtandard/kit/drizzle/pg";

/**
 * Options for {@link pgLinksTable}: `schema` (Postgres namespace; default the
 * public schema), `extraColumns`, `extraIndexes`, and `keyCollation` (default
 * `null`: a plain `text` key, as every earlier release; `"C"` for bytewise,
 * index-usable prefixes on new tables).
 */
export type PgLinksTableOptions = PgKvTableOptions;

/**
 * Build the Drizzle `pgTable` for the links KV store. Base columns are fixed —
 * `key text PRIMARY KEY`, `value jsonb NOT NULL` — and required by
 * `createDrizzleStorage`; `schema`/`extraColumns`/`extraIndexes` extend it.
 * The table name defaults to `"xtandard_links_kv"`. The key keeps the plain
 * `text` type of earlier releases, so existing schemas see no `drizzle-kit`
 * diff; prefix queries are exact either way.
 */
export function pgLinksTable(
  name = "xtandard_links_kv",
  opts?: PgLinksTableOptions,
): DrizzleKvTable {
  return pgKvTable(name, { keyCollation: null, ...opts });
}
