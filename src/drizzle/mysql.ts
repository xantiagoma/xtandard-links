/**
 * `@xtandard/links/drizzle/mysql` — MySQL Drizzle table factory for the
 * links KV store. Schema-only (imports just `drizzle-orm/mysql-core`).
 *
 * Base columns: `key varchar … COLLATE utf8mb4_bin PRIMARY KEY` (length configurable), `value json
 * NOT NULL`. `extraColumns`/`extraIndexes` mirror `drizzle-audit`.
 *
 * @example
 * ```ts
 * import { mysqlLinksTable } from "@xtandard/links/drizzle/mysql";
 * export const linksKv = mysqlLinksTable();
 * ```
 *
 * @module
 */

import type { BuildColumns } from "drizzle-orm";
import {
  json,
  mysqlTable,
  customType,
  type MySqlColumnBuilderBase,
  type MySqlTableExtraConfigValue,
} from "drizzle-orm/mysql-core";
import type { DrizzleKvTable } from "./table.ts";

export type { DrizzleKvTable } from "./table.ts";

/** The `self` passed to an {@link MysqlLinksTableOptions.extraIndexes} callback. */
type MysqlLinksColumns = BuildColumns<string, Record<string, MySqlColumnBuilderBase>, "mysql">;

/** Options for {@link mysqlLinksTable}. */
export interface MysqlLinksTableOptions {
  /**
   * `varchar` length for the `key` primary key. Default `512` (store keys are
   * short slash-delimited paths). Keep within your InnoDB index-prefix limit.
   */
  keyLength?: number;
  /** Additional columns merged into the table. */
  extraColumns?: () => Record<string, MySqlColumnBuilderBase>;
  /** Additional indexes/constraints; receives the built table for column references. */
  extraIndexes?: (table: MysqlLinksColumns) => MySqlTableExtraConfigValue[];
}

/** `varchar(n) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin` — exact, case-sensitive keys. */
const binaryVarchar = (name: string, config: { length: number }) =>
  customType<{ data: string; driverData: string }>({
    dataType: () => `varchar(${config.length}) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
  })(name);

/**
 * Build the MySQL `mysqlTable` for the links KV store: `key varchar PRIMARY
 * KEY`, `value json NOT NULL`. The table name defaults to `"xtandard_links_kv"`.
 */
export function mysqlLinksTable(
  name = "xtandard_links_kv",
  opts?: MysqlLinksTableOptions,
): DrizzleKvTable {
  const columns = {
    // Binary collation: MySQL's default (utf8mb4_0900_ai_ci) is case- and accent-insensitive,
    // which would merge keys such as `lnk/t/Acme/…` and `lnk/t/acme/…`.
    key: binaryVarchar("key", { length: opts?.keyLength ?? 512 }).primaryKey(),
    value: json("value").notNull(),
    ...opts?.extraColumns?.(),
  };
  // Cast to the exact `self` type Drizzle infers from `columns` — the public
  // `extraIndexes` type uses a generic column map, which is a supertype.
  const extraConfig = opts?.extraIndexes as
    | ((self: BuildColumns<string, typeof columns, "mysql">) => MySqlTableExtraConfigValue[])
    | undefined;
  return mysqlTable(name, columns, extraConfig);
}
