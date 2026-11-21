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
 * `getKeys` uses a non-blocking `SCAN` cursor (never the blocking `KEYS`
 * command), with glob metacharacters in the prefix escaped so it matches
 * verbatim. `watch` is implemented with Redis keyspace notifications; it
 * requires the server to be configured with `notify-keyspace-events` covering
 * generic + string + expiry events (e.g. `KEA` — whose `A` class also covers the
 * module events that RedisJSON writes emit, e.g. `json.set`).
 *
 * ## Compare-and-swap
 *
 * Both variants implement {@link CompareAndSwapLinksStorage} with a small Lua
 * script (atomic on the server). Claiming an absent key writes only if the key
 * does not exist. A swap reads the stored value, deep-compares it with
 * `expected` in JS, then runs the script with the exact serialized value it
 * read — the write lands only if nobody wrote in between. This makes slug
 * claims race-free across every process sharing the Redis.
 *
 * @module
 */

import type { RedisClientType } from "redis";
import { requirePeer } from "./contract.ts";
import type {
  CompareAndSwapLinksStorage,
  StorageChangeEvent,
  WatchableLinksStorage,
} from "./contract.ts";
import { deepEqual } from "./memory.ts";

/** Options for {@link createRedisStorage}. */
export interface RedisStorageOptions {
  /** Connection URL (e.g. `redis://localhost:6379`). Used when no `client` is given. */
  url?: string;
  /** A pre-constructed (optionally pre-connected) node-redis client. */
  client?: RedisClientType;
  /** Optional key namespace prepended to every key, joined with `:`. */
  prefix?: string;
  /**
   * Called on client `error` events (connection drops, reconnect failures).
   * A handler is always attached internally so a downed Redis never crashes the
   * process via an unhandled `error` event — this just lets you observe/log them.
   */
  onError?: (error: unknown) => void;
}

/**
 * A {@link WatchableLinksStorage} + {@link CompareAndSwapLinksStorage} backed by
 * Redis, plus a `close()` method that disconnects the client — but only the one
 * this adapter created. A client you passed in is left for you to manage.
 */
export interface RedisLinksStorage extends WatchableLinksStorage, CompareAndSwapLinksStorage {
  /** Disconnect the underlying client if this adapter created it. No-op otherwise. */
  close(): Promise<void>;
}

/** Minimal structural view of the node-redis client surface this adapter uses. */
interface RedisLike {
  isOpen?: boolean;
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  eval(script: string, options?: { keys?: string[]; arguments?: string[] }): Promise<unknown>;
  /** RedisJSON module commands (bundled in node-redis; the SERVER needs the module). */
  json?: {
    get(key: string): Promise<unknown>;
    set(key: string, path: string, value: unknown): Promise<unknown>;
  };
  scanIterator(options?: { MATCH?: string; COUNT?: number }): AsyncIterable<string | string[]>;
  duplicate(): RedisLike;
  pSubscribe(
    pattern: string,
    listener: (message: string, channel: string) => void,
  ): Promise<unknown>;
  disconnect(): Promise<unknown>;
}

/** How a variant reads/writes values (the only place the two adapters differ). */
interface RedisValueCodec {
  get(c: RedisLike, key: string): Promise<unknown>;
  set(c: RedisLike, key: string, value: unknown): Promise<void>;
  /** Lua expression: the raw serialized value of `KEYS[1]` (`false` when absent). */
  readRaw: string;
  /** Lua statement: write the JSON text `ARGV[2]` to `KEYS[1]`. */
  writeRaw: string;
}

/** Plain strings containing JSON — works on any Redis. */
const stringCodec: RedisValueCodec = {
  async get(c, key) {
    const raw = await c.get(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  },
  async set(c, key, value) {
    await c.set(key, JSON.stringify(value));
  },
  readRaw: "redis.call('GET', KEYS[1])",
  writeRaw: "redis.call('SET', KEYS[1], ARGV[2])",
};

/** Native RedisJSON documents — requires the JSON module on the server. */
const jsonCodec: RedisValueCodec = {
  async get(c, key) {
    const value = await requireJson(c).get(key);
    return value ?? null;
  },
  async set(c, key, value) {
    await requireJson(c).set(key, "$", value);
  },
  readRaw: "redis.call('JSON.GET', KEYS[1])",
  writeRaw: "redis.call('JSON.SET', KEYS[1], '$', ARGV[2])",
};

/**
 * Build the compare-and-swap script for a codec. `ARGV[1]` is `"0"` to claim an
 * absent key, or `"1"` to swap only when the raw stored value equals `ARGV[3]`
 * (the exact serialization the caller read). Returns 1 when it wrote.
 */
const casScript = (codec: RedisValueCodec): string => `
if ARGV[1] == '0' then
  if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
elseif ${codec.readRaw} ~= ARGV[3] then
  return 0
end
${codec.writeRaw}
return 1`;

/** Re-read attempts when a swap loses a race to a write that kept the value deep-equal. */
const CAS_RETRIES = 16;

/** Escape Redis glob metacharacters so a literal prefix matches verbatim in `SCAN MATCH`. */
const escapeGlob = (literal: string): string => literal.replace(/[\\*?[\]]/g, (c) => `\\${c}`);

function requireJson(c: RedisLike): NonNullable<RedisLike["json"]> {
  if (!c.json) {
    throw new Error(
      "createRedisJSONStorage: the client exposes no `json` commands — use node-redis " +
        "(the `redis` package) v4+, and a server with the RedisJSON module (Redis 8 / Redis Stack).",
    );
  }
  return c.json;
}

/**
 * Create a Redis-backed {@link RedisLinksStorage}. Connection is lazy: the
 * client is created/connected on the first storage operation and reused
 * thereafter, guarded by a single connection promise so concurrent calls connect
 * once.
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
  return buildRedisStorage(options, stringCodec);
}

/**
 * Create a Redis-backed {@link RedisLinksStorage} that stores values as native
 * **RedisJSON** documents (`JSON.SET`/`JSON.GET`) instead of strings — making
 * the stored records queryable with JSONPath (`JSON.GET key $.status`) and
 * indexable with RediSearch, while the links system behaves identically.
 *
 * Requires the JSON module on the server (built into Redis 8; Redis Stack; or
 * `redisjson` loaded). Same options and semantics as {@link createRedisStorage},
 * including lazy connection, `SCAN`-based `getKeys`, keyspace-notification
 * `watch`, and Lua-script `compareAndSwap`. **Do not point it at keys
 * written by `createRedisStorage`** (or vice versa) — the underlying types
 * differ and Redis answers `WRONGTYPE`.
 *
 * @example
 * ```ts
 * import { createRedisJSONStorage } from "@xtandard/links/storage/redis";
 *
 * const storage = createRedisJSONStorage({
 *   url: process.env.REDIS_URL ?? "redis://localhost:6379",
 *   prefix: "myapp:links",
 * });
 * // Then, in redis-cli: JSON.GET myapp:links:lnk/t/acme/links/lnk_1 $.url
 * ```
 */
export function createRedisJSONStorage(options: RedisStorageOptions): RedisLinksStorage {
  return buildRedisStorage(options, jsonCodec);
}

/** Shared implementation — connection, prefixing, SCAN, watch, compare-and-swap, close. */
function buildRedisStorage(
  options: RedisStorageOptions,
  codec: RedisValueCodec,
): RedisLinksStorage {
  const { url, prefix } = options;
  const fullPrefix = prefix ? `${prefix}:` : "";
  const ownsClient = !options.client;

  let client: RedisLike | undefined = options.client as RedisLike | undefined;
  let connecting: Promise<RedisLike> | undefined;

  // node-redis emits `error` on connection drops and reconnect attempts. Without a
  // listener Node treats it as an unhandled error and crashes the process — which
  // would defeat the whole "storage can be down" promise. Always attach one.
  const attachErrorHandler = (c: RedisLike): void => {
    c.on?.("error", (err: unknown) => options.onError?.(err));
  };
  if (client) attachErrorHandler(client);

  /** Resolve a connected client, creating/connecting on first use. */
  async function getClient(): Promise<RedisLike> {
    if (client?.isOpen) return client;
    connecting ??= (async () => {
      if (!client) {
        let createClient: (opts: Record<string, unknown>) => RedisLike;
        try {
          ({ createClient } = (await import("redis")) as unknown as {
            createClient: (opts: Record<string, unknown>) => RedisLike;
          });
        } catch {
          requirePeer("redis", "storage/redis");
        }
        // disableOfflineQueue: commands reject immediately when the socket is down
        // (instead of queueing forever) so callers fail fast — the redirect path
        // serves its last known good link — and the next call retries. The reconnect strategy keeps trying with a capped
        // backoff so it recovers automatically.
        client = createClient({
          url,
          disableOfflineQueue: true,
          socket: { reconnectStrategy: (retries: number) => Math.min(retries * 100, 3000) },
        });
        attachErrorHandler(client);
      }
      if (!client.isOpen) await client.connect();
      return client;
    })();
    try {
      return await connecting;
    } finally {
      connecting = undefined;
    }
  }

  /** Prepend the namespace to a caller key. */
  const toRedisKey = (key: string): string => `${fullPrefix}${key}`;
  /** Strip the namespace off a Redis key, yielding the caller key. */
  const fromRedisKey = (key: string): string =>
    fullPrefix && key.startsWith(fullPrefix) ? key.slice(fullPrefix.length) : key;

  const cas = casScript(codec);
  /** Read the raw serialized value (exactly what the CAS script compares against). */
  const readRawScript = `return ${codec.readRaw}`;

  return {
    async getItem<T>(key: string): Promise<T | null> {
      const c = await getClient();
      return ((await codec.get(c, toRedisKey(key))) as T | null) ?? null;
    },

    async setItem<T>(key: string, value: T): Promise<void> {
      const c = await getClient();
      await codec.set(c, toRedisKey(key), value);
    },

    async removeItem(key: string): Promise<void> {
      const c = await getClient();
      await c.del(toRedisKey(key));
    },

    async getKeys(prefix: string): Promise<string[]> {
      const c = await getClient();
      const match = `${escapeGlob(toRedisKey(prefix))}*`;
      const out: string[] = [];
      for await (const entry of c.scanIterator({ MATCH: match, COUNT: 100 })) {
        // node-redis v4 yields one key per iteration; v5 may yield batches.
        if (Array.isArray(entry)) {
          for (const k of entry) out.push(fromRedisKey(k));
        } else {
          out.push(fromRedisKey(entry));
        }
      }
      return out;
    },

    async compareAndSwap<T>(input: { key: string; expected: T | null; next: T }): Promise<boolean> {
      const c = await getClient();
      const redisKey = toRedisKey(input.key);
      const next = JSON.stringify(input.next);
      if (input.expected === null) {
        return (await c.eval(cas, { keys: [redisKey], arguments: ["0", next, ""] })) === 1;
      }
      for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
        const raw = await c.eval(readRawScript, { keys: [redisKey] });
        if (typeof raw !== "string") return false;
        if (!deepEqual(JSON.parse(raw), input.expected)) return false;
        const wrote = await c.eval(cas, { keys: [redisKey], arguments: ["1", next, raw] });
        if (wrote === 1) return true;
      }
      return false;
    },

    async watch(
      prefix: string,
      callback: (event: StorageChangeEvent) => void,
    ): Promise<() => void> {
      // Keyspace notifications publish to `__keyspace@<db>__:<key>`; subscribe to
      // all key events under our namespaced prefix and translate them.
      const c = await getClient();
      const subscriber = c.duplicate();
      attachErrorHandler(subscriber);
      await subscriber.connect();
      const pattern = `__keyspace@*__:${escapeGlob(toRedisKey(prefix))}*`;
      await subscriber.pSubscribe(pattern, (event: string, channel: string) => {
        const idx = channel.indexOf("__:");
        if (idx === -1) return;
        const redisKey = channel.slice(idx + 3);
        const key = fromRedisKey(redisKey);
        if (!key.startsWith(prefix)) return;
        const type: StorageChangeEvent["type"] =
          event === "del" || event === "expired" ? "remove" : "update";
        callback({ type, key });
      });
      return () => {
        void subscriber.disconnect();
      };
    },

    async close(): Promise<void> {
      if (ownsClient && client?.isOpen) await client.quit();
    },
  } satisfies RedisLinksStorage;
}
