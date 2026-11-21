/**
 * Adapter that wraps an [unstorage](https://unstorage.unjs.io) `Storage`
 * instance as a {@link LinksStorage}. The caller constructs and configures
 * their own unstorage instance (with whatever driver they like) and passes it in
 * — we never import `unstorage` at runtime, only its type. `unstorage` therefore
 * remains an optional peer dependency.
 *
 * The driver is `@xtandard/kit/storage/unstorage`: it escapes the characters
 * unstorage normalizes away (`%`, `?`, `\`, `:`, a trailing `$`, empty segments)
 * so every key round-trips exactly, writes strings JSON-encoded so a stored
 * `"123"` stays a string, and reads keys and values written by earlier releases.
 *
 * @module
 */

export {
  createUnstorageStorage,
  type UnstorageStorageOptions,
} from "@xtandard/kit/storage/unstorage";
