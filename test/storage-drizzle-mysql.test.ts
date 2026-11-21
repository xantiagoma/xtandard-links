import { drizzle } from "drizzle-orm/mysql2";
import { getTableConfig, type MySqlTable } from "drizzle-orm/mysql-core";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, test, vi } from "vitest";
import { mysqlLinksTable } from "../src/drizzle/mysql.ts";
import { createDrizzleStorage } from "../src/storage/drizzle.ts";
import { runStorageContractTests } from "./storage-contract.ts";

/**
 * Live MySQL suite for the Drizzle adapter (`drizzle-orm/mysql2`): runs the full contract —
 * including case-distinct keys (utf8mb4_bin) and LIKE metacharacters (`ESCAPE '!'`) — when a
 * MySQL 8 server is reachable at `MYSQL_URL`, and skips otherwise (CI provides a `mysql:8`
 * service). Each run works in its own database, dropped in `afterAll`.
 */
const MYSQL_URL = process.env.MYSQL_URL ?? "mysql://root:root@127.0.0.1:3306/links";

// Live round-trips are slow on a loaded machine (120 sequential inserts in one test).
vi.setConfig({ testTimeout: 30_000 });

let available = false;
try {
  const probe = await mysql.createConnection({ uri: MYSQL_URL, connectTimeout: 1500 });
  await probe.query("SELECT 1");
  await probe.end();
  available = true;
} catch {
  available = false;
}

const dbName = `links_test_${Date.now()}`;
let pool: mysql.Pool | undefined;

async function getPool(): Promise<mysql.Pool> {
  if (pool) return pool;
  const admin = await mysql.createConnection({ uri: MYSQL_URL });
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
  await admin.end();
  pool = mysql.createPool({ uri: MYSQL_URL, database: dbName, connectionLimit: 8 });
  return pool;
}

/** `CREATE TABLE` from the factory's own config, so the factory's DDL is what gets tested. */
function createTableSql(table: MySqlTable): string {
  const c = getTableConfig(table);
  const cols = c.columns.map(
    (col) =>
      `\`${col.name}\` ${col.getSQLType()}${col.notNull ? " NOT NULL" : ""}${col.primary ? " PRIMARY KEY" : ""}`,
  );
  return `CREATE TABLE \`${c.name}\` (${cols.join(", ")})`;
}

let n = 0;
describe.skipIf(!available)("drizzle mysql (live)", () => {
  runStorageContractTests(
    "drizzle (mysql2)",
    async () => {
      const p = await getPool();
      const table = mysqlLinksTable(`kv_${n++}`);
      await p.query(createTableSql(table as unknown as MySqlTable));
      // mysql2/promise and mysql2 ship separate Pool typings; the runtime object is the same.
      return createDrizzleStorage({ db: drizzle(p as never), table });
    },
    {
      t: { describe, test, expect },
      capabilities: { compareAndSwap: true, watch: false },
      timeout: 30_000,
    },
  );
});

afterAll(async () => {
  if (!pool) return;
  await pool.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
  await pool.end();
});
