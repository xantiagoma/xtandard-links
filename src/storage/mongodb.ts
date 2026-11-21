/**
 * MongoDB storage adapter built on the [`mongodb`](https://github.com/mongodb/node-mongodb-native)
 * driver, an optional peer dependency. You can either pass a pre-constructed
 * (optionally pre-connected) `MongoClient`, or a connection `url` to create and
 * connect a client lazily on first use.
 *
 * The backend is a single collection of `{ _id: <key>, value: <any> }` documents
 * (database `"xtandard_links"`, collection `"links_kv"` by default). The
 * storage key is stored verbatim as the document `_id`, and the value is stored
 * directly as a BSON field. The driver is `@xtandard/kit/storage/mongodb`.
 *
 * ## Compare-and-swap
 *
 * Implements {@link CompareAndSwapLinksStorage}. Claiming an absent key is an
 * `insertOne` — the unique `_id` index makes exactly one concurrent claimer win.
 * A swap compares structurally (field order is irrelevant) and only lands if
 * nobody wrote in between.
 *
 * ## Why no `watch`
 *
 * MongoDB change streams (the natural way to back {@link WatchableLinksStorage})
 * require a replica set or sharded cluster — they are unavailable on a standalone
 * `mongod`. To keep this adapter usable against any deployment, `watch` is
 * intentionally **not** implemented; the core feature-detects its absence via
 * `isWatchable` and falls back to polling.
 *
 * @module
 */

import * as kit from "@xtandard/kit/storage/mongodb";

/**
 * Options for {@link createMongoStorage}. `dbName` defaults to
 * `"xtandard_links"`, `collectionName` to `"links_kv"`.
 */
export type MongoStorageOptions = kit.MongoStorageOptions;

/**
 * A {@link CompareAndSwapLinksStorage} backed by MongoDB, plus a `close()` method that
 * disconnects the client — but only the one this adapter created. A client you
 * passed in is left for you to manage.
 */
export type MongoLinksStorage = kit.MongoKvStorage;

/**
 * Create a MongoDB-backed {@link MongoLinksStorage}.
 *
 * @example
 * ```ts
 * import { createMongoStorage } from "@xtandard/links/storage/mongodb";
 *
 * const storage = createMongoStorage({
 *   url: "mongodb://localhost:27017",
 *   dbName: "myapp",
 *   collectionName: "links_kv",
 * });
 * ```
 */
export function createMongoStorage(options: MongoStorageOptions): MongoLinksStorage {
  return kit.createMongoStorage({
    subpath: "@xtandard/links/storage/mongodb",
    ...options,
    dbName: options.dbName ?? "xtandard_links",
    collectionName: options.collectionName ?? "links_kv",
  });
}
