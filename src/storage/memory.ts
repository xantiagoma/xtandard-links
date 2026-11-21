/**
 * In-memory storage adapter. Zero deps. Useful for tests, dev, and the demo.
 * Values are deep-cloned on write and read so callers cannot mutate stored
 * state by reference. Implements `watch` and `compareAndSwap`.
 *
 * @module
 */

import type {
  CompareAndSwapLinksStorage,
  LinksStorage,
  StorageChangeEvent,
  WatchableLinksStorage,
} from "./contract.ts";

/** Options for {@link createMemoryStorage}. */
export interface MemoryStorageOptions {
  /** Optional seed data (key → value). */
  initial?: Record<string, unknown>;
}

/** The full capability set the memory adapter implements. */
export type MemoryLinksStorage = WatchableLinksStorage & CompareAndSwapLinksStorage;

const clone = <T>(value: T): T => (value === undefined ? value : (structuredClone(value) as T));

/** Structural deep equality for JSON-like values (used by compare-and-swap). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

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
  const map = new Map<string, unknown>();
  if (options.initial) {
    for (const [k, val] of Object.entries(options.initial)) map.set(k, clone(val));
  }

  const watchers = new Set<{ prefix: string; cb: (event: StorageChangeEvent) => void }>();
  const notify = (event: StorageChangeEvent) => {
    for (const w of watchers) {
      if (event.key.startsWith(w.prefix)) queueMicrotask(() => w.cb(event));
    }
  };

  const set = (key: string, value: unknown) => {
    map.set(key, clone(value));
    notify({ type: "update", key });
  };

  return {
    async getItem<T>(key: string): Promise<T | null> {
      return map.has(key) ? clone(map.get(key) as T) : null;
    },
    async setItem<T>(key: string, value: T): Promise<void> {
      set(key, value);
    },
    async removeItem(key: string): Promise<void> {
      if (map.delete(key)) notify({ type: "remove", key });
    },
    async getKeys(prefix: string): Promise<string[]> {
      const out: string[] = [];
      for (const k of map.keys()) if (k.startsWith(prefix)) out.push(k);
      return out;
    },
    async watch(prefix, cb): Promise<() => void> {
      const entry = { prefix, cb };
      watchers.add(entry);
      return () => {
        watchers.delete(entry);
      };
    },
    async compareAndSwap<T>(input: { key: string; expected: T | null; next: T }): Promise<boolean> {
      const current = map.has(input.key) ? map.get(input.key) : null;
      if (!deepEqual(current, input.expected)) return false;
      set(input.key, input.next);
      return true;
    },
  } satisfies LinksStorage & MemoryLinksStorage;
}
