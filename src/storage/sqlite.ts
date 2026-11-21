/**
 * SQLite storage adapter built on `bun:sqlite` — **Bun only**, zero npm deps.
 * Ideal for single-node deployments and local/dev persistence: durable, fast, and
 * file-backed (or in-memory). For multi-node runtimes prefer Redis/Postgres.
 *
 * `bun:sqlite` is marked external at build time, so this module only resolves
 * under the Bun runtime. Importing it under Node will throw — by design.
 *
 * ```ts
 * import { createSqliteStorage } from "@xtandard/links/storage/sqlite";
 * const storage = createSqliteStorage({ path: "./links.sqlite" });
 * ```
 *
 * Implements {@link CompareAndSwapLinksStorage}: each swap runs inside a
 * `BEGIN IMMEDIATE` transaction (read, deep-compare, write), which takes the
 * database write lock up front — so it is atomic within the process and across
 * processes sharing the same file.
 *
 * @module
 */

import { Database } from "bun:sqlite";
import type { CompareAndSwapLinksStorage } from "./contract.ts";
import { deepEqual } from "./memory.ts";

/** Options for {@link createSqliteStorage}. */
export interface SqliteStorageOptions {
  /** File path for the database. Default `":memory:"`. Ignored when `database` is given. */
  path?: string;
  /** An existing `bun:sqlite` Database instance to use instead of opening one. */
  database?: Database;
  /** Table name (default `"xtandard_links_kv"`). Validated as a safe identifier. */
  table?: string;
}

/** A {@link CompareAndSwapLinksStorage} backed by SQLite, plus `close()`. */
export interface SqliteLinksStorage extends CompareAndSwapLinksStorage {
  /** Close the database if this adapter opened it; no-op for a borrowed instance. */
  close(): void;
}

const escapeLike = (prefix: string): string => prefix.replace(/[\\%_]/g, (c) => `\\${c}`);

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
  const table = options.table ?? "xtandard_links_kv";
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    throw new Error(`Invalid table name: ${JSON.stringify(table)}`);
  }

  const ownsDb = !options.database;
  const db = options.database ?? new Database(options.path ?? ":memory:");
  db.run(`CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

  const selectStmt = db.query(`SELECT value FROM ${table} WHERE key = ?`);
  const upsertStmt = db.query(
    `INSERT INTO ${table} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  const deleteStmt = db.query(`DELETE FROM ${table} WHERE key = ?`);
  const keysStmt = db.query(`SELECT key FROM ${table} WHERE key LIKE ? ESCAPE '\\'`);

  /** Read-compare-write under the write lock; `immediate()` = `BEGIN IMMEDIATE`. */
  const swap = db.transaction((key: string, expected: unknown, next: unknown): boolean => {
    const row = selectStmt.get(key) as { value: string } | null;
    const current = row ? (JSON.parse(row.value) as unknown) : null;
    if (!deepEqual(current, expected)) return false;
    upsertStmt.run(key, JSON.stringify(next));
    return true;
  });

  return {
    async getItem<T>(key: string): Promise<T | null> {
      const row = selectStmt.get(key) as { value: string } | null;
      return row ? (JSON.parse(row.value) as T) : null;
    },
    async setItem<T>(key: string, value: T): Promise<void> {
      upsertStmt.run(key, JSON.stringify(value));
    },
    async removeItem(key: string): Promise<void> {
      deleteStmt.run(key);
    },
    async getKeys(prefix: string): Promise<string[]> {
      const rows = keysStmt.all(`${escapeLike(prefix)}%`) as Array<{ key: string }>;
      return rows.map((r) => r.key);
    },
    async compareAndSwap<T>(input: { key: string; expected: T | null; next: T }): Promise<boolean> {
      return swap.immediate(input.key, input.expected, input.next);
    },
    close(): void {
      if (ownsDb) db.close();
    },
  } satisfies SqliteLinksStorage;
}
