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
 * columns this adapter reads and writes.
 *
 * @example
 * ```ts
 * import { drizzle } from "drizzle-orm/node-postgres";
 * import { createDrizzleStorage } from "@xtandard/links/storage/drizzle";
 * import { pgLinksTable } from "@xtandard/links/drizzle/pg";
 *
 * export const linksKv = pgLinksTable(); // add to your schema + migrate
 * const db = drizzle(pool);                    // your existing pool
 * const storage = createDrizzleStorage({ db, table: linksKv });
 * ```
 *
 * ## Compare-and-swap
 *
 * On **Postgres and SQLite** tables the adapter also implements
 * {@link CompareAndSwapLinksStorage} (so slug claims are race-free across
 * processes): claiming an absent key is `INSERT … ON CONFLICT DO NOTHING
 * RETURNING key`, and a swap reads the value, deep-compares it with `expected`,
 * then runs `UPDATE … WHERE key = ? AND value = <the value it read> RETURNING
 * key`, which only lands if nobody wrote in between. **MySQL** has no
 * `RETURNING`, so a MySQL-table storage omits `compareAndSwap` and the core
 * falls back to read-then-write (ADR 0005).
 *
 * @module
 */

import { and, entityKind, eq, sql, type Column, type SQL, type Table } from "drizzle-orm";
import type { CompareAndSwapLinksStorage, LinksStorage } from "./contract.ts";
import { deepEqual } from "./memory.ts";
import type { DrizzleKvTable } from "../drizzle/table.ts";

export type { DrizzleKvTable } from "../drizzle/table.ts";

/**
 * Minimal structural view of a Drizzle database — the query-builder entry points
 * the KV adapter uses. This is the internal contract the adapter casts `db` to;
 * the public option is typed `unknown` because a dialect-agnostic structural type
 * cannot match dialect-specific dbs (their `.from`/`.insert` want `PgTable` etc.,
 * not the base `Table`). The upsert method differs by dialect and is
 * feature-detected at runtime; `onConflictDoNothing`/`returning`/`update` are
 * only used on Postgres + SQLite (compare-and-swap).
 */
interface DrizzleLikeDatabase {
  select(fields: Record<string, Column>): {
    from(table: Table): { where(where: SQL): PromiseLike<unknown[]> };
  };
  insert(table: Table): {
    values(row: { key: string; value: unknown }): {
      /** Postgres + SQLite upsert. */
      onConflictDoUpdate?(config: {
        target: Column;
        set: { value: unknown };
      }): PromiseLike<unknown>;
      /** MySQL upsert. */
      onDuplicateKeyUpdate?(config: { set: { value: unknown } }): PromiseLike<unknown>;
      /** Postgres + SQLite insert-if-absent. */
      onConflictDoNothing?(config: { target: Column }): {
        returning(fields: Record<string, Column>): PromiseLike<unknown[]>;
      };
    };
  };
  update(table: Table): {
    set(values: { value: unknown }): {
      where(where: SQL): { returning(fields: Record<string, Column>): PromiseLike<unknown[]> };
    };
  };
  delete(table: Table): { where(where: SQL): PromiseLike<unknown> };
}

/** Options for {@link createDrizzleStorage}. */
export interface DrizzleStorageOptions {
  /**
   * Your Drizzle database (node-postgres / mysql2 / better-sqlite3 / pglite / …).
   * Typed `unknown` intentionally — a single dialect-agnostic type can't match
   * every dialect's db; the adapter only calls `select`/`insert`/`delete`.
   */
  db: unknown;
  /** The KV table built with a `*LinksTable` factory (or matching that shape). */
  table: DrizzleKvTable;
}

/**
 * A {@link LinksStorage} over a Drizzle table. `compareAndSwap` is present on
 * Postgres and SQLite tables and absent on MySQL ones — feature-detect it with
 * `isCompareAndSwap`. For push change-notifications, compose it with
 * {@link ./watch.withWatch} + a change source (e.g. {@link ./watch.pgListenNotify})
 * — `watch` is orthogonal to the adapter.
 */
export type DrizzleLinksStorage = LinksStorage &
  Partial<Pick<CompareAndSwapLinksStorage, "compareAndSwap">>;

/** Re-read attempts when a swap loses a race to a write that kept the value deep-equal. */
const CAS_RETRIES = 16;

/** Is this a MySQL Drizzle table? (No `RETURNING`, so no compare-and-swap.) */
const isMySqlTable = (table: Table): boolean => {
  const kind = (table.constructor as { [entityKind]?: unknown })[entityKind];
  return typeof kind === "string" && kind.startsWith("MySql");
};

/** Escape LIKE wildcards so `getKeys` matches the prefix verbatim (paired with `ESCAPE '\'`). */
const escapeLike = (literal: string): string => literal.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Parse a value defensively — Drizzle returns json parsed, but a string is parsed too. */
const parseValue = <T>(value: unknown): T => {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }
  return value as T;
};

/**
 * Create a Drizzle-backed {@link DrizzleLinksStorage}. No DDL, no connection
 * ownership. The upsert dialect (Postgres/SQLite `onConflictDoUpdate` vs MySQL
 * `onDuplicateKeyUpdate`) is detected at runtime from the insert builder.
 */
export function createDrizzleStorage(options: DrizzleStorageOptions): DrizzleLinksStorage {
  const db = options.db as DrizzleLikeDatabase;
  const { table } = options;

  const storage: LinksStorage = {
    async getItem<T>(key: string): Promise<T | null> {
      const rows = (await db
        .select({ value: table.value })
        .from(table)
        .where(eq(table.key, key))) as Array<{ value: unknown }>;
      const row = rows[0];
      if (row === undefined || row.value === null || row.value === undefined) return null;
      return parseValue<T>(row.value);
    },

    async setItem<T>(key: string, value: T): Promise<void> {
      const insert = db.insert(table).values({ key, value });
      if (typeof insert.onConflictDoUpdate === "function") {
        await insert.onConflictDoUpdate({ target: table.key, set: { value } });
      } else if (typeof insert.onDuplicateKeyUpdate === "function") {
        await insert.onDuplicateKeyUpdate({ set: { value } });
      } else {
        throw new Error(
          "createDrizzleStorage: the Drizzle database exposes no known upsert method " +
            "(onConflictDoUpdate / onDuplicateKeyUpdate).",
        );
      }
    },

    async removeItem(key: string): Promise<void> {
      await db.delete(table).where(eq(table.key, key));
    },

    async getKeys(prefix: string): Promise<string[]> {
      const pattern = `${escapeLike(prefix)}%`;
      const rows = (await db
        .select({ key: table.key })
        .from(table)
        .where(sql`${table.key} like ${pattern} escape '\\'`)) as Array<{ key: unknown }>;
      return rows.map((row) => String(row.key));
    },
  };

  if (isMySqlTable(table)) return storage;

  return {
    ...storage,
    async compareAndSwap<T>(input: { key: string; expected: T | null; next: T }): Promise<boolean> {
      const { key, next } = input;
      if (input.expected === null) {
        const insert = db.insert(table).values({ key, value: next });
        if (typeof insert.onConflictDoNothing !== "function") {
          throw new Error(
            "createDrizzleStorage: compareAndSwap needs onConflictDoNothing (Postgres/SQLite).",
          );
        }
        const rows = await insert
          .onConflictDoNothing({ target: table.key })
          .returning({ key: table.key });
        return rows.length === 1;
      }
      for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
        const rows = (await db
          .select({ value: table.value })
          .from(table)
          .where(eq(table.key, key))) as Array<{ value: unknown }>;
        const observed = rows[0]?.value;
        if (observed === undefined || observed === null) return false;
        if (!deepEqual(parseValue(observed), input.expected)) return false;
        // `observed` is bound through the value column's own encoder, so the
        // comparison is against exactly what was read (jsonb compares
        // structurally; SQLite JSON text round-trips byte-identically).
        const updated = await db
          .update(table)
          .set({ value: next })
          .where(and(eq(table.key, key), eq(table.value, observed)) as SQL)
          .returning({ key: table.key });
        if (updated.length === 1) return true;
      }
      return false;
    },
  } satisfies LinksStorage & CompareAndSwapLinksStorage;
}
