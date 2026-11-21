/**
 * Cloudflare Workers KV storage adapter. It wraps a `KVNamespace` **binding** —
 * the object Workers exposes on `env.MY_KV` — so it works in production Workers,
 * in local dev via `wrangler dev` / [Miniflare](https://miniflare.dev), and in
 * tests against any object that satisfies the small {@link KVNamespaceLike}
 * surface. There is **no npm peer dependency**: the binding is provided by the
 * runtime, so this adapter only needs the structural type.
 *
 * KV is eventually consistent and has a ~25 MB per-value limit and list
 * pagination — acceptable for a links control plane at library scale. An
 * optional `prefix` namespaces every key (joined with `:`) and is stripped from
 * {@link CloudflareKvLinksStorage.getKeys} results, so several deployments
 * can share one namespace. The driver is `@xtandard/kit/storage/cloudflare-kv`.
 *
 * **No compare-and-swap:** KV has no conditional write, so this adapter does
 * not implement `compareAndSwap`. Slug claims fall back to read-then-write with
 * a re-read check (ADR 0005) — two simultaneous claims of the same slug from
 * different colos can both appear to win until KV converges. If that matters,
 * keep the control plane on a CAS-capable store (D1 via Drizzle, Postgres, …)
 * and use KV only where a stale read is acceptable.
 *
 * ```ts
 * import { createCloudflareKvStorage } from "@xtandard/links/storage/cloudflare-kv";
 *
 * export default {
 *   async fetch(req: Request, env: { LINKS: KVNamespace }) {
 *     const storage = createCloudflareKvStorage({ namespace: env.LINKS, prefix: "prod" });
 *     // …build the links core over `storage`…
 *   },
 * };
 * ```
 *
 * @module
 */

export {
  createCloudflareKvStorage,
  type CloudflareKvStorage as CloudflareKvLinksStorage,
  type CloudflareKvStorageOptions,
  type KVNamespaceLike,
} from "@xtandard/kit/storage/cloudflare-kv";
