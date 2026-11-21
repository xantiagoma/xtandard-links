/**
 * The memory-first link resolver (ADR 0002): an LRU of links keyed by
 * `host/slug-key` with a TTL, stale-while-revalidate, a negative cache,
 * last-known-good on storage errors, request coalescing, and instant eviction
 * on changes (same-process core mutations always; cross-process when the
 * storage is watchable).
 *
 * @module
 */

import type { LinksCore } from "./core.ts";
import { domainKey, slugsPrefix } from "./keys.ts";
import type { Domain, Link } from "./schema.ts";
import { slugKey } from "./slug.ts";
import { isWatchable } from "./storage/contract.ts";

/** Options for {@link createResolver}. */
export interface ResolverOptions {
  /** Max cached entries (links + misses + domains). Default 10 000. */
  maxEntries?: number;
  /** How long a cached link is fresh (ms). Default 60 000. `0` disables caching. */
  ttlMs?: number;
  /** How long a miss is cached (ms). Default 10 000. */
  negativeTtlMs?: number;
  /** Subscribe to storage changes when the storage supports `watch`. Default `true`. */
  watch?: boolean;
  /** Errors from storage reads (the resolver itself never throws). */
  onError?: (error: unknown) => void;
}

/** Cache statistics. */
export interface ResolverStats {
  hits: number;
  misses: number;
  stale: number;
  errors: number;
  size: number;
}

/** A resolved domain + link. */
export interface Resolution {
  /** The domain record, or `null` when the host is not a registered domain. */
  domain: Domain | null;
  link: Link | null;
}

/** The resolver. */
export interface Resolver {
  /** Resolve a domain record (cached). Never throws. */
  domain(hostname: string): Promise<Domain | null>;
  /** Resolve `host/slug` (cached). Never throws. */
  resolve(hostname: string, slug: string): Promise<Resolution>;
  /** Drop one entry, a whole host, or everything. */
  invalidate(hostname?: string, slugKey?: string): void;
  /** Load every link into the cache (small installs). */
  preload(): Promise<number>;
  stats(): ResolverStats;
  /** Unsubscribe from storage/core change feeds. */
  close(): void;
}

interface Entry<T> {
  value: T;
  /** Epoch millis after which the entry is stale. */
  freshUntil: number;
  refreshing?: Promise<unknown>;
}

/**
 * Create a resolver over a core.
 *
 * @example
 * ```ts
 * const resolver = createResolver(core, { ttlMs: 30_000 });
 * const { link } = await resolver.resolve("go.acme.com", "sale");
 * ```
 */
export function createResolver(core: LinksCore, options: ResolverOptions = {}): Resolver {
  const maxEntries = options.maxEntries ?? 10_000;
  const ttlMs = options.ttlMs ?? 60_000;
  const negativeTtlMs = options.negativeTtlMs ?? 10_000;
  const onError = options.onError ?? ((e) => console.warn("[@xtandard/links] resolver:", e));
  const cache = new Map<string, Entry<Link | null>>();
  const domains = new Map<string, Entry<Domain | null>>();
  const inflight = new Map<string, Promise<unknown>>();
  const stats = { hits: 0, misses: 0, stale: 0, errors: 0 };
  const cleanups: (() => void)[] = [];

  const linkKey = (host: string, key: string) => `${host}\u0000${key}`;

  function touch<T>(map: Map<string, Entry<T>>, key: string, entry: Entry<T>): void {
    map.delete(key);
    map.set(key, entry);
    while (cache.size + domains.size > maxEntries) {
      const victim = cache.size > 0 ? cache : domains;
      const oldest = victim.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      victim.delete(oldest);
    }
  }

  /** Coalesced load with last-known-good fallback. */
  async function cached<T>(
    map: Map<string, Entry<T>>,
    key: string,
    load: () => Promise<T>,
  ): Promise<T | undefined> {
    const now = core.now();
    const entry = map.get(key);
    if (entry && ttlMs > 0) {
      if (entry.freshUntil > now) {
        stats.hits++;
        touch(map, key, entry);
        return entry.value;
      }
      // Stale: serve now, refresh in the background (once).
      stats.stale++;
      if (!entry.refreshing) {
        entry.refreshing = refresh(map, key, load).finally(() => {
          entry.refreshing = undefined;
        });
      }
      return entry.value;
    }
    stats.misses++;
    return refresh(map, key, load);
  }

  async function refresh<T>(
    map: Map<string, Entry<T>>,
    key: string,
    load: () => Promise<T>,
  ): Promise<T | undefined> {
    const flightKey = `${map === (cache as unknown) ? "l" : "d"}:${key}`;
    const running = inflight.get(flightKey) as Promise<T | undefined> | undefined;
    if (running) return running;
    const p = (async () => {
      try {
        const value = await load();
        if (ttlMs > 0) {
          const ttl = value === null ? negativeTtlMs : ttlMs;
          touch(map, key, { value, freshUntil: core.now() + ttl });
        }
        return value;
      } catch (error) {
        stats.errors++;
        onError(error);
        return map.get(key)?.value; // last known good (undefined when never loaded)
      } finally {
        inflight.delete(flightKey);
      }
    })();
    inflight.set(flightKey, p);
    return p;
  }

  async function domain(hostname: string): Promise<Domain | null> {
    const host = hostname.toLowerCase();
    return (await cached(domains, host, () => core.getDomain(host))) ?? null;
  }

  function invalidate(hostname?: string, key?: string): void {
    if (hostname === undefined) {
      cache.clear();
      domains.clear();
      return;
    }
    const host = hostname.toLowerCase();
    if (key !== undefined) {
      cache.delete(linkKey(host, key));
      return;
    }
    domains.delete(host);
    for (const k of cache.keys()) if (k.startsWith(`${host}\u0000`)) cache.delete(k);
  }

  cleanups.push(core.onChange((change) => invalidate(change.hostname, change.slugKey)));

  if ((options.watch ?? true) && isWatchable(core.storage)) {
    const storage = core.storage;
    const decode = (s: string) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    };
    void storage
      .watch(slugsPrefix(), (event) => {
        const [host, key] = event.key.slice(slugsPrefix().length).split("/");
        if (host && key) invalidate(decode(host), decode(key));
      })
      .then((off) => cleanups.push(off))
      .catch(onError);
    void storage
      .watch(domainKey(""), (event) => {
        const host = event.key.slice(domainKey("").length);
        if (host) invalidate(decode(host));
      })
      .then((off) => cleanups.push(off))
      .catch(onError);
    // Link records change without their pointer (edits): evict by scanning cached ids.
    void storage
      .watch("lnk/t/", (event) => {
        if (!event.key.includes("/links/")) return;
        const id = decode(event.key.slice(event.key.lastIndexOf("/") + 1));
        for (const [k, entry] of cache) if (entry.value?.id === id) cache.delete(k);
      })
      .then((off) => cleanups.push(off))
      .catch(onError);
  }

  return {
    domain,
    async resolve(hostname, slug) {
      const host = hostname.toLowerCase();
      const d = await domain(host);
      const key = slugKey(slug, d?.caseSensitive ?? false);
      const link =
        (await cached(cache, linkKey(host, key), () => core.getLinkBySlug(host, slug))) ?? null;
      return { domain: d, link };
    },
    invalidate,
    async preload() {
      let n = 0;
      for (const d of await core.listDomains()) {
        touch(domains, d.hostname, { value: d, freshUntil: core.now() + ttlMs });
      }
      for (const t of await core.listTenants()) {
        let cursor: string | undefined;
        do {
          const page = await core.listLinks(t.key, {
            archived: "all",
            limit: 500,
            ...(cursor ? { cursor } : {}),
          });
          for (const link of page.links) {
            const d = await domain(link.domain);
            touch(cache, linkKey(link.domain, slugKey(link.slug, d?.caseSensitive ?? false)), {
              value: link,
              freshUntil: core.now() + ttlMs,
            });
            n++;
          }
          cursor = page.nextCursor;
        } while (cursor);
      }
      return n;
    },
    stats: () => ({ ...stats, size: cache.size + domains.size }),
    close() {
      for (const off of cleanups.splice(0)) off();
    },
  };
}
