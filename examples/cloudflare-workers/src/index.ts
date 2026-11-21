/**
 * `@xtandard/links` on the edge — redirects and the admin API in a Cloudflare
 * Worker, on Workers KV + Workers Analytics Engine. No origin server.
 *
 *   wrangler dev          # Miniflare simulates KV locally — no account needed
 *   wrangler deploy
 *
 * Routes:
 *   *  /links/*   → the admin JSON API (bearer `LINKS_ADMIN_TOKEN`); API-only on
 *                   Workers (no filesystem for the bundled UI) — run the panel UI
 *                   from a Node/Bun origin over the same KV if you want it.
 *   *  /*         → short links on `LINKS_DOMAIN` (and the deep-link
 *                   association files); anything else → 404 page.
 *
 * Clicks are captured after the response with `ctx.waitUntil`, enriched with
 * `request.cf` geo via `cloudflareGeo()`, and written to Analytics Engine.
 */
import {
  cloudflareGeo,
  createFetchHandler,
  createLinksCore,
  createRedirectHandler,
  type AuthProvider,
  type CreateFetchHandlerResult,
  type RedirectHandler,
} from "@xtandard/links";
import {
  createAnalyticsEngine,
  type AnalyticsEngineDataset,
} from "@xtandard/links/analytics/analytics-engine";
import {
  createCloudflareKvStorage,
  type KVNamespaceLike,
} from "@xtandard/links/storage/cloudflare-kv";

/** Bindings and vars declared in wrangler.toml (structural: no workers-types needed). */
interface Env {
  LINKS: KVNamespaceLike;
  LINKS_ANALYTICS: AnalyticsEngineDataset;
  LINKS_DOMAIN: string;
  CF_ACCOUNT_ID?: string;
  CF_ANALYTICS_TOKEN?: string;
  LINKS_ADMIN_TOKEN?: string;
}

/** The slice of the Workers `ExecutionContext` used here. */
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

// One core per isolate: the resolver's in-memory cache survives across requests
// on a warm isolate, so most redirects never touch KV.
let planes: { redirects: RedirectHandler; panel: CreateFetchHandlerResult } | undefined;

function getPlanes(env: Env) {
  if (planes) return planes;
  const core = createLinksCore({
    storage: createCloudflareKvStorage({ namespace: env.LINKS }),
    analytics: createAnalyticsEngine({
      dataset: env.LINKS_ANALYTICS,
      datasetName: "links_events",
      ...(env.CF_ACCOUNT_ID ? { accountId: env.CF_ACCOUNT_ID } : {}),
      ...(env.CF_ANALYTICS_TOKEN ? { apiToken: env.CF_ANALYTICS_TOKEN } : {}),
    }),
    defaultDomain: env.LINKS_DOMAIN,
  });
  const redirects = createRedirectHandler({
    core,
    geo: cloudflareGeo(), // request.cf → country, city, continent, …
    // No timers on the edge: each click is flushed through ctx.waitUntil.
    ingestor: { flushIntervalMs: 0 },
    // KV is eventually consistent and not watchable; re-check cached links every 30s.
    resolver: { ttlMs: 30_000 },
  });
  const panel = createFetchHandler({
    core,
    basePath: "/links",
    auth: bearerAuth(env.LINKS_ADMIN_TOKEN),
  });
  planes = { redirects, panel };
  return planes;
}

/** A minimal bearer-token guard for the admin API (swap for auth/basic or auth/delegated). */
function bearerAuth(token: string | undefined): AuthProvider {
  return {
    async authenticate(request) {
      if (!token) return null; // no token configured → admin API closed
      return request.headers.get("authorization") === `Bearer ${token}` ? { id: "admin" } : null;
    },
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { redirects, panel } = getPlanes(env);
    const { pathname } = new URL(request.url);
    if (pathname === "/links" || pathname.startsWith("/links/")) return panel.fetch(request);
    // Short link → redirect; otherwise the built-in 404 page (a dedicated short domain).
    return redirects.fetch(request, { waitUntil: (p) => ctx.waitUntil(p) });
  },
};
