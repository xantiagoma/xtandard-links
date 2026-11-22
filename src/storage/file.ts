/**
 * File-system storage adapter. Persists each key as a JSON file under a base
 * directory, mirroring the slash-delimited key layout (`lnk/t/{tenant}/…`) as a
 * tree of nested directories with a `.json` extension on the leaf. Each key
 * segment is encoded into a case-safe file name ({@link encodeSegment}), so keys
 * that differ only by case or accent stay distinct on case-insensitive
 * filesystems (macOS and Windows defaults). Zero external dependencies — uses
 * `node:fs/promises`, which works in both Bun and Node.
 *
 * The driver is `@xtandard/kit/storage/file`: writes are atomic (temporary file
 * + rename), `compareAndSwap` is serialized per key within one process, and
 * empty key segments are distinct keys.
 *
 * @module
 */

import * as kit from "@xtandard/kit/storage/file";

export {
  clearFileStorage,
  decodeSegment,
  encodeSegment,
  migrateFileStorage,
  type FileLegacyMode,
} from "@xtandard/kit/storage/file";

/**
 * Options for {@link createFileStorage}. `legacy` defaults to `"ignore"`: every
 * links release already wrote the encoded layout, so there is no older layout
 * to read.
 */
export type FileStorageOptions = kit.FileStorageOptions;

/** A watchable, compare-and-swap capable file-backed storage. */
export type FileLinksStorage = kit.FileKvStorage;

/**
 * Create a file-backed storage. Values are serialized as JSON. `watch` is
 * implemented via `fs.watch` on the base directory (recursive); it is
 * best-effort and may coalesce or miss events on platforms without
 * recursive-watch support.
 *
 * @example
 * ```ts
 * import { createFileStorage } from "@xtandard/links/storage/file";
 *
 * const storage = createFileStorage({ dir: "./data/links" });
 * ```
 */
export function createFileStorage(options: FileStorageOptions): FileLinksStorage {
  return kit.createFileStorage({ legacy: "ignore", ...options });
}
