/**
 * One storage contract, every backend: the identical
 * create → click → rollup → read-back loop on each driver.
 *
 *   bun run src/index.ts
 *
 * memory, file and sqlite always run. Set any of these to include the others:
 *
 *   REDIS_URL=redis://localhost:6379
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
 *   MONGO_URL=mongodb://localhost:27017
 *   LIBSQL_URL=libsql://….turso.io  LIBSQL_AUTH_TOKEN=…   (or LIBSQL_URL=file:./links-libsql.db)
 *
 * Each run uses a fresh tenant and deletes it afterwards, so it is safe to point
 * at a shared database.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLinksCore, createRedirectHandler, type LinksStorage } from "@xtandard/links";
import { createFileStorage } from "@xtandard/links/storage/file";
import { createLibsqlStorage } from "@xtandard/links/storage/libsql";
import { createMemoryStorage } from "@xtandard/links/storage/memory";
import { createMongoStorage } from "@xtandard/links/storage/mongodb";
import { createPostgresStorage } from "@xtandard/links/storage/postgres";
import { createRedisStorage } from "@xtandard/links/storage/redis";
import { createSqliteStorage } from "@xtandard/links/storage/sqlite";

interface Driver {
  name: string;
  /** Build the storage and a cleanup for it. */
  open(): Promise<{ storage: LinksStorage; close(): Promise<void> }>;
}

const drivers: Driver[] = [
  {
    name: "memory",
    open: async () => ({ storage: createMemoryStorage(), close: async () => {} }),
  },
  {
    name: "file",
    async open() {
      const dir = await mkdtemp(join(tmpdir(), "xtandard-links-"));
      return {
        storage: createFileStorage({ dir }),
        close: () => rm(dir, { recursive: true, force: true }),
      };
    },
  },
  {
    name: "sqlite",
    async open() {
      const storage = createSqliteStorage({ path: ":memory:" });
      return { storage, close: async () => storage.close() };
    },
  },
];

if (process.env.REDIS_URL) {
  drivers.push({
    name: "redis",
    async open() {
      const storage = createRedisStorage({ url: process.env.REDIS_URL, prefix: "links-example" });
      return { storage, close: () => storage.close() };
    },
  });
}
if (process.env.DATABASE_URL) {
  drivers.push({
    name: "postgres",
    async open() {
      const storage = createPostgresStorage({ connectionString: process.env.DATABASE_URL });
      return { storage, close: () => storage.close() };
    },
  });
}
if (process.env.MONGO_URL) {
  drivers.push({
    name: "mongodb",
    async open() {
      const storage = createMongoStorage({ url: process.env.MONGO_URL });
      return { storage, close: () => storage.close() };
    },
  });
}
if (process.env.LIBSQL_URL) {
  drivers.push({
    name: "libsql",
    async open() {
      const storage = createLibsqlStorage({
        url: process.env.LIBSQL_URL,
        ...(process.env.LIBSQL_AUTH_TOKEN ? { authToken: process.env.LIBSQL_AUTH_TOKEN } : {}),
      });
      return { storage, close: async () => storage.close() };
    },
  });
}

const BROWSER =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function exercise(driver: Driver): Promise<string> {
  const { storage, close } = await driver.open();
  const tenant = `example-${crypto.randomUUID().slice(0, 8)}`;
  // The default analytics sink keeps hourly/daily rollups in the same storage.
  const core = createLinksCore({ storage, defaultDomain: "sho.rt", counterFlushMs: 0 });
  const pending: Promise<unknown>[] = [];
  const redirects = createRedirectHandler({ core, ingestor: { flushIntervalMs: 0 } });
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
  try {
    const started = performance.now();
    const link = await core.createLink({
      tenant,
      url: "https://example.com/hello",
      tags: ["demo"],
    });

    // A browser user agent: requests without one are flagged as bots, not counted.
    const click = () =>
      new Request(`https://sho.rt/${link.slug}`, { headers: { "user-agent": BROWSER } });
    const res = await redirects.fetch(click(), ctx);
    await redirects.fetch(click(), ctx);
    await Promise.all(pending);
    await redirects.ingestor?.flush();
    await core.flushCounters();

    const fromStorage = await core.getLinkBySlug("sho.rt", link.slug);
    const now = Date.now();
    const stats = await core.queryAnalytics({
      tenant,
      from: new Date(now - 3_600_000).toISOString(),
      to: new Date(now + 60_000).toISOString(),
    });
    const clicks = await core.getClickCount(tenant, link.id);
    const ms = (performance.now() - started).toFixed(0);

    if (
      res.status !== 302 ||
      fromStorage?.id !== link.id ||
      stats.totals.clicks !== 2 ||
      clicks !== 2
    ) {
      throw new Error(
        `unexpected: status=${res.status} found=${fromStorage?.id} rollupClicks=${stats.totals.clicks} counter=${clicks}`,
      );
    }
    return `✓ ${driver.name.padEnd(9)} /${link.slug} → ${res.status}, 2 clicks rolled up, counter=${clicks} (${ms} ms)`;
  } finally {
    await core.deleteTenant(tenant).catch(() => {});
    await redirects.close();
    await core.close();
    await close();
  }
}

let failed = 0;
for (const driver of drivers) {
  try {
    console.log(await exercise(driver));
  } catch (error) {
    failed++;
    console.log(
      `✗ ${driver.name.padEnd(9)} ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
const skipped = ["REDIS_URL", "DATABASE_URL", "MONGO_URL", "LIBSQL_URL"].filter(
  (v) => !process.env[v],
);
if (skipped.length) console.log(`(set ${skipped.join(" / ")} to include more backends)`);
process.exit(failed ? 1 : 0);
