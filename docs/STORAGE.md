# Storage

Links, domains, slug pointers, customers and attribution data live behind a four-method async KV
contract, so `@xtandard/links` runs on the database you already operate. Optional capabilities are
feature-detected at runtime (ADR [0005](ADR/0005-storage-kv-contract.md)). Analytics are separate:
they go through the [analytics sink](ANALYTICS.md), which by default stores rollups in this same
storage.

## The contract

```ts
interface LinksStorage {
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<void>;
  removeItem(key: string): Promise<void>;
  getKeys(prefix: string): Promise<string[]>;
}
```

Values are JSON-serializable. Optional capabilities, each its own interface with a guard
(`isCompareAndSwap`, `isWatchable`, `isTransactional`):

- **`compareAndSwap({ key, expected, next })`**: write `next` only if the stored value deep-equals
  `expected` (`null` = the key is absent); resolves `true` when it wrote. Used for slug claims
  (race-free uniqueness across processes), click counters, KV analytics rollups and one-time
  deferred-handoff claims.
- **`watch(prefix, callback)`**: change notifications. The [resolver](ARCHITECTURE.md#the-resolver)
  uses them to evict cached links the moment another process edits them.
- **`transaction(fn)`**: declared for parity with the sibling libraries; the core does not need it.

## Drivers

| Driver         | Import                                  | Factory                                        | Peer                       | Compare-and-swap | Watch                              |
| -------------- | --------------------------------------- | ---------------------------------------------- | -------------------------- | ---------------- | ---------------------------------- |
| Memory         | `@xtandard/links/storage/memory`        | `createMemoryStorage`                          | —                          | ✓                | ✓                                  |
| File (JSON)    | `@xtandard/links/storage/file`          | `createFileStorage`                            | — (`node:fs`)              | ✓ (in-process)   | ✓ (`fs.watch`)                     |
| Redis          | `@xtandard/links/storage/redis`         | `createRedisStorage`, `createRedisJSONStorage` | `redis` (node-redis 4/5)   | ✓ (Lua)          | ✓ (keyspace notifications)         |
| Postgres       | `@xtandard/links/storage/postgres`      | `createPostgresStorage`                        | `pg` (or pglite)           | ✓                | via `withWatch` + `pgListenNotify` |
| Drizzle        | `@xtandard/links/storage/drizzle`       | `createDrizzleStorage`                         | `drizzle-orm`              | ✓                | via `withWatch`                    |
| MongoDB        | `@xtandard/links/storage/mongodb`       | `createMongoStorage`                           | `mongodb`                  | ✓                | via `withWatch`                    |
| SQLite         | `@xtandard/links/storage/sqlite`        | `createSqliteStorage`                          | — (`bun:sqlite`, Bun only) | ✓                | —                                  |
| libSQL / Turso | `@xtandard/links/storage/libsql`        | `createLibsqlStorage`                          | `@libsql/client`           | ✓                | —                                  |
| unstorage      | `@xtandard/links/storage/unstorage`     | `createUnstorageStorage`                       | `unstorage`                | —                | via `withWatch`                    |
| Cloudflare KV  | `@xtandard/links/storage/cloudflare-kv` | `createCloudflareKvStorage`                    | — (the binding)            | —                | —                                  |

The drivers are `@xtandard/kit/storage/*` with the links defaults (tables, Mongo names, the pg
channel). Every driver passes the kit's conformance suite plus the links key-layout cases
(`test/storage-contract.ts`). Writes are canonical JSON (key order), and compare-and-swap also
matches a value an earlier release stored in another key order. Missing optional peers fail on
first use with an actionable message that names the `@xtandard/links/storage/*` import. Drivers that open their own
connection expose `close()`; a client you pass in is borrowed and never closed.

### Options

```ts
createMemoryStorage({ initial?: Record<string, unknown> });

createFileStorage({ dir: "./.links/storage" });

createRedisStorage({
  url: "redis://localhost:6379", // or client: an existing node-redis client
  prefix: "xtandard:links", // optional; joined with ":" and stripped from getKeys
  onError: (e) => log.warn(e), // connection errors never crash the process
});
createRedisJSONStorage({ url }); // same options, values as RedisJSON documents (Redis 8 / Stack)

createPostgresStorage({
  connectionString: process.env.DATABASE_URL, // or url, or client: pg Pool/Client / PGlite
  table: "xtandard_links_kv", // default; created on first use (key text PK, value jsonb)
});

createDrizzleStorage({ db, table: pgLinksTable() }); // see "Drizzle" below; issues no DDL

createMongoStorage({
  url: "mongodb://localhost:27017", // or client: a MongoClient
  dbName: "xtandard_links",
  collectionName: "links", // documents { _id: key, value }
});

createSqliteStorage({ path: "./links.sqlite" /* default ":memory:" */, table: "xtandard_links_kv" });
// or database: an existing bun:sqlite Database

createLibsqlStorage({
  url: process.env.TURSO_DATABASE_URL!, // libsql://…, or "file:links.db" / embedded replica
  authToken: process.env.TURSO_AUTH_TOKEN,
  table: "xtandard_links_kv",
}); // or client: an existing @libsql/client

createUnstorageStorage({ storage: createStorage({ driver: vercelKVDriver({ … }) }) });

createCloudflareKvStorage({ namespace: env.LINKS, prefix: "prod" });
```

### Choosing

- **One process, local disk**: SQLite (Bun) or File. File is human-readable and watchable; its
  compare-and-swap and writes (temporary file + rename) are safe within one process only: fine for
  one writer.
- **Several app instances**: Postgres, Redis, MongoDB, libSQL, or Drizzle over Postgres/SQLite.
  Compare-and-swap makes slug claims race-free across every process; Redis also evicts caches
  instantly through keyspace notifications.
- **Edge**: Cloudflare KV for a Workers-only setup, libSQL/Turso over HTTP, or unstorage over an
  HTTP-reachable store. See [Deployment](DEPLOYMENT.md).

### Without compare-and-swap

unstorage and Cloudflare KV have no conditional write (File's only holds within one process). Slug claims fall back to
read-then-write with a re-read check, the same stance as the siblings' plain-KV mode: safe with a
single writer, but two processes claiming the same slug at the same instant can both appear to win
(the later write owns the pointer; the other link's slug does not resolve). Cloudflare KV is also
eventually consistent across colos, which widens that window. If several writers matter, keep the
control plane on a CAS-capable store (Postgres, Redis, D1 via Drizzle…) and use KV only where a
stale read is acceptable. Click counters and KV analytics rollups use plain read-modify-write there
too, so concurrent processes can lose increments.

## Change notifications: `withWatch`

`watch` is orthogonal to the backend, so instead of baking it into every driver, `withWatch` adds it
to any storage from a change signal your infrastructure already has:

```ts
import { withWatch, pgListenNotify } from "@xtandard/links";
import { createPostgresStorage } from "@xtandard/links/storage/postgres";
import { Client } from "pg";

const listener = new Client({ connectionString: process.env.DATABASE_URL });
await listener.connect(); // a dedicated Client: a Pool rotates connections

const storage = withWatch(
  createPostgresStorage({ connectionString: process.env.DATABASE_URL }),
  pgListenNotify(listener, "xtandard_links"),
);
```

`pgListenNotify` only `LISTEN`s: your migration owns the trigger that `pg_notify`s the channel with
the changed key as payload:

```sql
CREATE OR REPLACE FUNCTION xtandard_links_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('xtandard_links', COALESCE(NEW.key, OLD.key));
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER xtandard_links_notify
AFTER INSERT OR UPDATE OR DELETE ON xtandard_links_kv
FOR EACH ROW EXECUTE FUNCTION xtandard_links_notify();
```

Any other source works the same way: `withWatch(storage, (notify) => { …; return unsubscribe })`,
calling `notify(key)` on each change (Redis pub/sub, an ORM after-write hook, MongoDB change streams
on a replica set). Without watch, edits made by another process reach a redirect handler within the
resolver's TTL (60 s by default); edits made through the same core are always evicted immediately.

## Drizzle

Keep the links table in your own Drizzle schema and migrations. The table helpers build the fixed
`key` / `value` shape the adapter needs; the adapter issues no DDL and reuses your `db`:

```ts
// schema.ts
import { pgLinksTable } from "@xtandard/links/drizzle/pg";
export const linksKv = pgLinksTable(); // "xtandard_links_kv"

// server.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { createDrizzleStorage } from "@xtandard/links/storage/drizzle";

const storage = createDrizzleStorage({ db: drizzle(pool), table: linksKv });
```

| Helper                                              | Columns                                                                                         | Options                                                     |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `pgLinksTable(name?, opts?)` (`drizzle/pg`)         | `key text PRIMARY KEY`, `value jsonb NOT NULL`                                                  | `schema`, `keyCollation`, `extraColumns`, `extraIndexes`    |
| `mysqlLinksTable(name?, opts?)` (`drizzle/mysql`)   | `key varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PRIMARY KEY`, `value json NOT NULL` | `keyLength`, `keyCollation`, `extraColumns`, `extraIndexes` |
| `sqliteLinksTable(name?, opts?)` (`drizzle/sqlite`) | `key text PRIMARY KEY`, `value text NOT NULL` (JSON mode)                                       | `extraColumns`, `extraIndexes`                              |

**MySQL: keep the binary collation.** MySQL's default collation (`utf8mb4_0900_ai_ci`) is case- and
accent-insensitive, which would merge keys such as `lnk/t/Acme/…` and `lnk/t/acme/…` (two tenants,
or two slugs on a case-sensitive domain). The helper declares `utf8mb4_bin`; if you write the table
by hand or alter it, keep a binary collation on `key`. Mind InnoDB's index-prefix limit when raising
`keyLength`. Every dialect has compare-and-swap, MySQL included.

**MySQL: trailing spaces.** `utf8mb4_bin` is a PAD SPACE collation: `"a "` and `"a"` are the same
primary key. The driver compares keys byte-exactly and throws `KeyCollisionError` rather than let
one overwrite the other. links keys never end in a space (every variable segment is URI-encoded, so
a space is stored as `%20`), so this only matters for keys you write yourself. New tables can opt
into a NO PAD collation with `keyCollation` (`"utf8mb4_0900_bin"` on MySQL 8.0+,
`"utf8mb4_nopad_bin"` on MariaDB); the default stays `utf8mb4_bin`, so existing schemas see no
`drizzle-kit` diff. `pgLinksTable` keeps a plain `text` key for the same reason; `keyCollation: "C"`
opts new tables into bytewise, index-usable prefixes.

## Key layout

Root `lnk`, slash-delimited; every variable segment is `encodeURIComponent`-encoded so nested slugs
and odd ids cannot escape their prefix (`src/keys.ts`):

```txt
lnk/tenants                              string[] index
lnk/t/{tenant}/meta                      Tenant
lnk/domains                              string[] index (hostnames)
lnk/domains/{hostname}                   Domain
lnk/s/{hostname}/{slugKey}               SlugPointer { tenant, id }  ← the redirect lookup
lnk/t/{tenant}/links/{id}                Link
lnk/t/{tenant}/ext/{externalId}          link id
lnk/t/{tenant}/customers/{id}            Customer
lnk/t/{tenant}/sales/{invoiceId}         SaleEvent (invoice idempotency)
lnk/t/{tenant}/counters/{id}             number (approximate click counter)
lnk/t/{tenant}/audit-log                 AuditEntry[]
lnk/clicks/{clickId}                     ClickRef (attribution window)
lnk/deferred/c/{clickId}                 DeferredHandoff
lnk/deferred/f/{fingerprint}/{clickId}   1 (fingerprint index)
lnk/rollup/…                             analytics rollups (analytics/kv only)
```

Keys are case-exact on every backend and `getKeys` matches its prefix literally (no `LIKE` or glob
wildcards leak through), which the conformance suite asserts.

### File driver encoding

The file driver mirrors the key layout as nested directories, one `.json` file per key, under
`dir`. So that keys survive case-insensitive and normalizing file systems (macOS, Windows) and
never escape their directory, each segment is encoded: uppercase letters become `^` + the lowercase
letter, `^` becomes `^^`, bytes outside `[a-z0-9._~!@,=+-]` become `%XX`, and a leading `.` is
`%2E`. `lnk/t/Acme/meta` is stored at `lnk/t/^acme/meta.json`. `encodeSegment` / `decodeSegment`
are exported for tooling.

## Writing your own driver

Implement the four methods (and `compareAndSwap` if your backend has a conditional write), then run
the conformance suite against it:

```ts
// my-storage.test.ts, inside this repository's test setup
import { describe, expect, test } from "vitest";
import { runStorageContractTests } from "./storage-contract.ts";
import { createMyStorage } from "../src/my-storage.ts";

runStorageContractTests("my storage", () => createMyStorage({ … }), {
  t: { describe, test, expect }, // vitest or bun:test
  // Declare every capability; `false` for what the driver lacks.
  capabilities: { compareAndSwap: true, watch: { settleMs: 50 } },
});
```

It covers round-trips of every JSON shape, encoded and Unicode keys, prefix isolation, prefixes
containing `LIKE` / glob metacharacters, case-exact keys, many keys, and, opt-in, compare-and-swap
semantics (absent-key claims, swaps only on equality, exactly one winner among concurrent claims)
and watch events under a prefix. See [Testing](TESTING.md).
