/**
 * Storage contracts. The base {@link LinksStorage} is intentionally tiny —
 * four async methods — so users can bring their own backend. Optional
 * capabilities (watch, compare-and-swap) are separate interfaces that adapters
 * may implement and the core feature-detects (ADR 0005).
 *
 * The neutral contract lives in `@xtandard/kit/storage`; these are the links
 * names for it.
 *
 * @module
 */

import { requirePeer as kitRequirePeer } from "@xtandard/kit/storage";

export type {
  CompareAndSwapKvStorage as CompareAndSwapLinksStorage,
  KvStorage as LinksStorage,
  StorageChangeEvent,
  TransactionalKvStorage as TransactionalLinksStorage,
  WatchableKvStorage as WatchableLinksStorage,
} from "@xtandard/kit/storage";
export { isCompareAndSwap, isTransactional, isWatchable } from "@xtandard/kit/storage";

/**
 * Helper for adapters whose subpath requires an optional peer dependency. Throws
 * a clear, actionable error when the peer is missing.
 */
export function requirePeer(name: string, subpath: string): never {
  return kitRequirePeer(name, `@xtandard/links/${subpath}`);
}
