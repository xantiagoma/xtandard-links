/**
 * SQLite storage adapter built on `bun:sqlite` — **Bun only**, zero npm deps.
 * Ideal for single-node deployments and local/dev persistence: durable, fast, and
 * file-backed (or in-memory). For multi-node runtimes prefer Redis/Postgres.
 *
 * The driver is `@xtandard/kit/storage/sqlite`. `bun:sqlite` is loaded on first
 * use, so importing this module works under Node; opening a database needs Bun.
 * The table (default `"xtandard_links_kv"`) is created on first use.
 *
 * ```ts
 * import { createSqliteStorage } from "@xtandard/links/storage/sqlite";
 * const storage = createSqliteStorage({ path: "./links.sqlite" });
 * ```
 *
 * Implements {@link CompareAndSwapLinksStorage} with one conditional statement
 * against the canonical JSON, falling back to a structural compare for rows
 * written by earlier releases.
 *
 * @module
 */

import * as kit from "@xtandard/kit/storage/sqlite";

/** Options for {@link createSqliteStorage}. `table` defaults to `"xtandard_links_kv"`. */
export type SqliteStorageOptions = kit.SqliteStorageOptions;

/** A compare-and-swap capable {@link LinksStorage} backed by SQLite, plus `close()`. */
export type SqliteLinksStorage = kit.SqliteKvStorage;

/**
 * Create a SQLite-backed storage. Requires the Bun runtime (`bun:sqlite`).
 *
 * @example
 * ```ts
 * import { createSqliteStorage } from "@xtandard/links/storage/sqlite";
 *
 * // File-backed (persists across restarts):
 * const storage = createSqliteStorage({ path: "./links.sqlite" });
 *
 * // In-memory (reset each run, useful for tests):
 * // const storage = createSqliteStorage({ path: ":memory:" });
 * ```
 */
export function createSqliteStorage(options: SqliteStorageOptions = {}): SqliteLinksStorage {
  return kit.createSqliteStorage({
    subpath: "@xtandard/links/storage/sqlite",
    ...options,
    table: options.table ?? "xtandard_links_kv",
  });
}
