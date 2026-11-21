/**
 * MongoDB storage adapter built on the [`mongodb`](https://github.com/mongodb/node-mongodb-native)
 * driver, an optional peer dependency. You can either pass a pre-constructed
 * (optionally pre-connected) `MongoClient`, or a connection `url` to create and
 * connect a client lazily on first use.
 *
 * The backend is a single collection of `{ _id: <key>, value: <any> }` documents.
 * The storage key is stored verbatim as the document `_id`, and the value is
 * stored directly as a BSON field — MongoDB persists arbitrary objects, arrays,
 * and primitives, so no JSON (de)serialisation round-trip is needed.
 *
 * `getKeys(prefix)` matches `_id` against an anchored regular expression
 * (`^<escaped prefix>`), projecting only `_id` so the server never ships values
 * back for a key listing.
 *
 * ## Compare-and-swap
 *
 * Implements {@link CompareAndSwapLinksStorage}. Claiming an absent key is an
 * `insertOne` — the unique `_id` index makes exactly one concurrent claimer win
 * (the others get a duplicate-key error, reported as `false`). A swap reads the
 * stored value, deep-compares it with `expected` in JS (Mongo's own equality
 * on embedded documents is field-order sensitive), then `updateOne`s filtered
 * on the exact value it read, so the write only lands if nobody wrote in
 * between.
 *
 * ## Why no `watch`
 *
 * MongoDB change streams (the natural way to back {@link WatchableLinksStorage})
 * require a replica set or sharded cluster — they are unavailable on a standalone
 * `mongod`. To keep this adapter usable against any deployment, `watch` is
 * intentionally **not** implemented; the core feature-detects its absence via
 * {@link import("./contract.ts").isWatchable} and falls back to polling.
 *
 * @module
 */

import type { MongoClient, Collection, Document } from "mongodb";
import { requirePeer } from "./contract.ts";
import type { CompareAndSwapLinksStorage } from "./contract.ts";
import { deepEqual } from "./memory.ts";

/** Options for {@link createMongoStorage}. */
export interface MongoStorageOptions {
  /** A pre-constructed (optionally pre-connected) mongodb `MongoClient`. */
  client?: MongoClient;
  /**
   * Connection string (e.g. `mongodb://localhost:27017`). When no `client` is
   * given, a `MongoClient` is created lazily on first use via a dynamic
   * `import("mongodb")`.
   */
  url?: string;
  /** Database name. Defaults to `"xtandard_links"`. */
  dbName?: string;
  /** Collection name. Defaults to `"links_kv"`. */
  collectionName?: string;
}

/**
 * A {@link CompareAndSwapLinksStorage} backed by MongoDB, plus a `close()` method that
 * disconnects the client — but only the one this adapter created. A client you
 * passed in is left for you to manage.
 *
 * Note: `watch` is deliberately absent (see the module docs); this is not a
 * {@link import("./contract.ts").WatchableLinksStorage}.
 */
export interface MongoLinksStorage extends CompareAndSwapLinksStorage {
  /** Disconnect the underlying client if this adapter created it. No-op otherwise. */
  close(): Promise<void>;
}

/** Shape of a single key/value document stored in the backing collection. */
interface KvDoc extends Document {
  /** The storage key, stored verbatim as the Mongo document id. */
  _id: string;
  /** The stored value — arbitrary BSON (object, array, or primitive). */
  value: unknown;
}

/**
 * Escape characters that are special in a regular expression so a literal
 * prefix string can be embedded into an anchored `^...` match.
 */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Create a MongoDB-backed {@link MongoLinksStorage}. Connection is lazy: the
 * client is created/connected on the first storage operation and reused
 * thereafter, guarded by a single connection promise so concurrent calls connect
 * once.
 *
 * @example
 * ```ts
 * import { createMongoStorage } from "@xtandard/links/storage/mongodb";
 *
 * const storage = createMongoStorage({
 *   url: process.env.MONGODB_URL ?? "mongodb://localhost:27017",
 *   dbName: "myapp",
 *   collectionName: "links_kv",
 * });
 *
 * // Disconnect when the process exits:
 * // process.on("SIGTERM", () => storage.close());
 * ```
 */
export function createMongoStorage(options: MongoStorageOptions): MongoLinksStorage {
  const { url, dbName = "xtandard_links", collectionName = "links_kv" } = options;
  const ownsClient = !options.client;

  let client: MongoClient | undefined = options.client;
  let connecting: Promise<Collection<KvDoc>> | undefined;

  /** Resolve a connected collection, creating/connecting the client on first use. */
  async function getCollection(): Promise<Collection<KvDoc>> {
    connecting ??= (async () => {
      if (!client) {
        let MongoClientCtor: new (url: string) => MongoClient;
        try {
          ({ MongoClient: MongoClientCtor } = (await import("mongodb")) as unknown as {
            MongoClient: new (url: string) => MongoClient;
          });
        } catch {
          requirePeer("mongodb", "storage/mongodb");
        }
        if (url === undefined) {
          throw new Error(
            '@xtandard/links/storage/mongodb requires either a "client" or a "url" option.',
          );
        }
        client = new MongoClientCtor(url);
      }
      // node-mongodb's connect() is idempotent — calling it on an already
      // connected client is a no-op — but guard regardless so a passed-in,
      // already-connected client never surfaces a spurious error.
      try {
        await client.connect();
      } catch (error) {
        if (!isAlreadyConnected(error)) throw error;
      }
      return client.db(dbName).collection<KvDoc>(collectionName);
    })();
    try {
      return await connecting;
    } catch (error) {
      // Let a later operation retry the connection rather than caching a failure.
      connecting = undefined;
      throw error;
    }
  }

  return {
    async getItem<T>(key: string): Promise<T | null> {
      const collection = await getCollection();
      const doc = await collection.findOne({ _id: key });
      return doc ? (doc.value as T) : null;
    },

    async setItem<T>(key: string, value: T): Promise<void> {
      const collection = await getCollection();
      await collection.updateOne({ _id: key }, { $set: { value } }, { upsert: true });
    },

    async removeItem(key: string): Promise<void> {
      const collection = await getCollection();
      await collection.deleteOne({ _id: key });
    },

    async getKeys(prefix: string): Promise<string[]> {
      const collection = await getCollection();
      const cursor = collection
        .find({ _id: { $regex: `^${escapeRegex(prefix)}` } })
        .project<{ _id: string }>({ _id: 1 });
      const out: string[] = [];
      for await (const doc of cursor) out.push(doc._id);
      return out;
    },

    async compareAndSwap<T>(input: { key: string; expected: T | null; next: T }): Promise<boolean> {
      const collection = await getCollection();
      if (input.expected === null) {
        try {
          await collection.insertOne({ _id: input.key, value: input.next });
          return true;
        } catch (error) {
          if (isDuplicateKey(error)) return false;
          throw error;
        }
      }
      for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
        const doc = await collection.findOne({ _id: input.key });
        if (!doc || !deepEqual(doc.value, input.expected)) return false;
        const result = await collection.updateOne(
          { _id: input.key, value: doc.value },
          { $set: { value: input.next } },
        );
        if (result.matchedCount === 1) return true;
      }
      return false;
    },

    async close(): Promise<void> {
      if (ownsClient && client) await client.close();
    },
  } satisfies MongoLinksStorage;
}

/** Re-read attempts when a swap loses a race to a write that kept the value deep-equal. */
const CAS_RETRIES = 16;

/** MongoDB duplicate-key error (`E11000`), raised when an `_id` is already taken. */
function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 11000;
}

/**
 * Heuristic: does this error indicate the client was already connected? The
 * driver's exact message has varied across versions, so match loosely.
 */
function isAlreadyConnected(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("already") && message.includes("connect");
}
