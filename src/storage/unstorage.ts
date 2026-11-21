/**
 * Adapter that wraps an [unstorage](https://unstorage.unjs.io) `Storage`
 * instance as a {@link LinksStorage}. The caller constructs and configures
 * their own unstorage instance (with whatever driver they like) and passes it in
 * — we never import `unstorage` at runtime, only its type. `unstorage` therefore
 * remains an optional peer dependency.
 *
 * unstorage normalizes key separators to `:` internally. We write `/`-style keys
 * (which unstorage accepts), but its `getKeys(base)` returns `:`-separated keys.
 * This adapter converts those back to `/` so callers always see the keys they
 * wrote.
 *
 * @module
 */

import type { Storage } from "unstorage";
import type { LinksStorage } from "./contract.ts";

/** Options for {@link createUnstorageStorage}. */
export interface UnstorageStorageOptions {
  /** A pre-constructed unstorage `Storage` instance (any driver). */
  storage: Storage;
}

/** Convert an unstorage `:`-separated key back to the `/`-separated form. */
const ESCAPES: Record<string, string> = { "%": "%25", "?": "%3F", "\\": "%5C", ":": "%3A" };
const UNESCAPES: Record<string, string> = { "%25": "%", "%3F": "?", "%5C": "\\", "%3A": ":" };

/**
 * unstorage's key normalization is lossy (it cuts at `?`, turns `\\` and `/` into `:`, and
 * collapses repeated `:`), so escape `%`, `?`, `\\` and `:` inside segments before handing keys
 * over: every key round-trips exactly.
 */
const toUnstorageKey = (key: string): string =>
  key.replace(/[%?\\:]/g, (ch) => ESCAPES[ch] as string);

/** Convert an unstorage `:`-separated key back to the original `/`-separated key. */
const fromUnstorageKey = (key: string): string =>
  key.replace(/:/g, "/").replace(/%(25|3F|5C|3A)/g, (m) => UNESCAPES[m] as string);

/**
 * Create a {@link LinksStorage} backed by an unstorage `Storage` instance.
 * unstorage auto-serializes/deserializes JSON values, so values round-trip
 * structurally; missing keys read back as `null`.
 *
 * @example
 * ```ts
 * import { createUnstorageStorage } from "@xtandard/links/storage/unstorage";
 * import { createStorage } from "unstorage";
 * import fsDriver from "unstorage/drivers/fs";
 *
 * const storage = createUnstorageStorage({
 *   storage: createStorage({ driver: fsDriver({ base: "./data/links" }) }),
 * });
 * ```
 */
export function createUnstorageStorage(options: UnstorageStorageOptions): LinksStorage {
  const { storage } = options;

  return {
    async getItem<T>(key: string): Promise<T | null> {
      const value = await storage.getItem<T>(toUnstorageKey(key));
      return value === undefined ? null : value;
    },

    async setItem<T>(key: string, value: T): Promise<void> {
      // unstorage's setItem rejects `undefined`; the contract never stores it.
      await storage.setItem(toUnstorageKey(key), value as NonNullable<T>);
    },

    async removeItem(key: string): Promise<void> {
      await storage.removeItem(toUnstorageKey(key));
    },

    async getKeys(prefix: string): Promise<string[]> {
      // unstorage's getKeys takes a base and returns matching keys with `:`
      // separators; convert them back so callers get their original `/` keys.
      // unstorage treats the base as a namespace (`lnk:x` lists `lnk:x:*` only), while the
      // contract is a plain string prefix: list from the last `/` boundary, then filter.
      const base = prefix.slice(0, prefix.lastIndexOf("/") + 1);
      const keys = await storage.getKeys(toUnstorageKey(base));
      return keys.map(fromUnstorageKey).filter((key) => key.startsWith(prefix));
    },
  } satisfies LinksStorage;
}
