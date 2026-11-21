/**
 * In-memory storage adapter. Zero deps. Useful for tests, dev, and the demo.
 * Values are deep-cloned on write and read so callers cannot mutate stored
 * state by reference. Implements `watch` and `compareAndSwap`.
 *
 * The driver is `@xtandard/kit/storage/memory`.
 *
 * @module
 */

import * as kit from "@xtandard/kit/storage/memory";

/**
 * Structural deep equality for JSON-like values (used by compare-and-swap):
 * own properties only, object key order ignored.
 */
export { deepEqual } from "@xtandard/kit/storage";

/** Options for {@link createMemoryStorage}. */
export type MemoryStorageOptions = kit.MemoryStorageOptions;

/** The full capability set the memory adapter implements. */
export type MemoryLinksStorage = kit.MemoryKvStorage;

/**
 * Create an in-memory {@link LinksStorage}. `watch` fires callbacks on the
 * next microtask after a write/remove; `compareAndSwap` compares deep equality.
 *
 * @example
 * ```ts
 * import { createMemoryStorage } from "@xtandard/links/storage/memory";
 *
 * const storage = createMemoryStorage();
 * ```
 */
export function createMemoryStorage(options: MemoryStorageOptions = {}): MemoryLinksStorage {
  return kit.createMemoryStorage(options);
}
