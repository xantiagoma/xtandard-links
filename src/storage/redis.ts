/**
 * Redis storage adapters built on the [`redis`](https://github.com/redis/node-redis)
 * package (node-redis v4/v5), an optional peer dependency. You can either pass a
 * pre-connected `client` or a `url` to connect lazily on first use. An optional
 * `prefix` is prepended (with a `:` separator) to every key so multiple
 * deployments can share a Redis instance without collisions; the prefix is
 * stripped from keys returned by {@link RedisLinksStorage.getKeys}.
 *
 * Two variants over the same plumbing, differing only in the value encoding:
 *
 * - {@link createRedisStorage} — values are plain **strings** containing JSON
 *   (`SET`/`GET`). Works on any Redis; the default choice.
 * - {@link createRedisJSONStorage} — values are native **RedisJSON** documents
 *   (`JSON.SET`/`JSON.GET`), so the stored data is queryable with JSONPath and
 *   indexable with RediSearch. Requires the JSON module (Redis 8 / Redis Stack).
 *   Do NOT point both variants at the same keys — the types are incompatible
 *   (`WRONGTYPE`).
 *
 * The driver is `@xtandard/kit/storage/redis`: `getKeys` uses a de-duplicated,
 * glob-escaped `SCAN` (never the blocking `KEYS`); `watch` uses keyspace
 * notifications and needs `notify-keyspace-events` covering generic + string +
 * expiry events (e.g. `KEA`, whose `A` class also covers RedisJSON's module
 * events); `compareAndSwap` is a Lua script, so slug claims are race-free across
 * every process sharing the Redis.
 *
 * @module
 */

import * as kit from "@xtandard/kit/storage/redis";

/** Options for {@link createRedisStorage} and {@link createRedisJSONStorage}. */
export type RedisStorageOptions = kit.RedisStorageOptions;

/**
 * A {@link WatchableLinksStorage} + {@link CompareAndSwapLinksStorage} backed by
 * Redis, plus a `close()` method that disconnects the client — but only the one
 * this adapter created. A client you passed in is left for you to manage.
 */
export type RedisLinksStorage = kit.RedisKvStorage;

const SUBPATH = "@xtandard/links/storage/redis";

/**
 * Create a Redis-backed {@link RedisLinksStorage}. Connection is lazy: the
 * client is created/connected on the first storage operation and reused
 * thereafter.
 *
 * @example
 * ```ts
 * import { createRedisStorage } from "@xtandard/links/storage/redis";
 *
 * const storage = createRedisStorage({
 *   url: process.env.REDIS_URL ?? "redis://localhost:6379",
 *   prefix: "myapp:links",
 *   onError: (err) => console.error("[links/redis]", err),
 * });
 *
 * // Disconnect when the process exits:
 * // process.on("SIGTERM", () => storage.close());
 * ```
 */
export function createRedisStorage(options: RedisStorageOptions): RedisLinksStorage {
  return kit.createRedisStorage({ subpath: SUBPATH, ...options });
}

/**
 * Create a Redis-backed {@link RedisLinksStorage} that stores values as native
 * **RedisJSON** documents (`JSON.SET`/`JSON.GET`) instead of strings. Requires
 * the JSON module on the server (built into Redis 8; Redis Stack; or
 * `redisjson` loaded). Same options and semantics as {@link createRedisStorage}.
 * **Do not point it at keys written by `createRedisStorage`** (or vice versa) —
 * the underlying types differ and Redis answers `WRONGTYPE`.
 *
 * @example
 * ```ts
 * import { createRedisJSONStorage } from "@xtandard/links/storage/redis";
 *
 * const storage = createRedisJSONStorage({
 *   url: process.env.REDIS_URL ?? "redis://localhost:6379",
 *   prefix: "myapp:links",
 * });
 * ```
 */
export function createRedisJSONStorage(options: RedisStorageOptions): RedisLinksStorage {
  return kit.createRedisJSONStorage({ subpath: SUBPATH, ...options });
}
