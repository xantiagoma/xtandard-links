/**
 * Testing utilities — `@xtandard/links/testing`.
 *
 * - {@link createTestLinks}: an in-memory core + redirect handler with a
 *   manual-flush ingestor and a memory analytics sink you can inspect.
 * - {@link clickRequest}: build a realistic redirect request (user agent,
 *   geo headers, referrer, language).
 * - {@link USER_AGENTS}: a few real user agents for tests and demos.
 *
 * @module testing
 */

import {
  aggregateEvents,
  type AnalyticsCapabilities,
  type AnalyticsSink,
} from "./analytics/contract.ts";
import { createLinksCore, type LinksCore, type LinksCoreOptions } from "./core.ts";
import {
  createRedirectHandler,
  type RedirectHandler,
  type RedirectHandlerOptions,
} from "./redirect.ts";
import type { AnalyticsEvent } from "./schema.ts";
import { createMemoryStorage, type MemoryLinksStorage } from "./storage/memory.ts";

/** A sink that keeps every event in an array (exact reference aggregation). */
export interface CollectingSink extends AnalyticsSink {
  /** Every ingested event, in ingest order. */
  readonly collected: AnalyticsEvent[];
  clear(): void;
}

/** Create a {@link CollectingSink}. */
export function createCollectingSink(): CollectingSink {
  const events: AnalyticsEvent[] = [];
  const capabilities: AnalyticsCapabilities = {
    crossFilter: true,
    uniques: false,
    events: true,
    intervals: ["hour", "day"],
  };
  return {
    capabilities,
    collected: events,
    clear: () => void events.splice(0),
    async ingest(batch) {
      events.push(...batch);
    },
    async query(query) {
      return aggregateEvents(events, query);
    },
    async events(query) {
      return events
        .filter((e) => e.tenant === query.tenant)
        .filter((e) => !query.linkIds || query.linkIds.includes(e.linkId))
        .filter((e) => !query.types || query.types.includes(e.type))
        .filter((e) => query.includeBots || e.type !== "click" || !e.bot)
        .filter((e) => !query.before || e.at < query.before)
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .slice(0, query.limit ?? 50);
    },
  };
}

/** Options for {@link createTestLinks}. */
export interface TestLinksOptions extends Omit<LinksCoreOptions, "storage" | "analytics"> {
  /** Redirect handler options (the ingestor is always manual-flush). */
  redirect?: Omit<RedirectHandlerOptions, "core" | "ingestor">;
  /** Use your own sink instead of the collecting sink. */
  analytics?: AnalyticsSink;
}

/** Result of {@link createTestLinks}. */
export interface TestLinks {
  core: LinksCore;
  storage: MemoryLinksStorage;
  redirects: RedirectHandler;
  sink: AnalyticsSink;
  /** The collecting sink's events (empty when a custom sink was given). */
  events: AnalyticsEvent[];
  /** Flush clicks, counters and background writes. */
  flush(): Promise<void>;
}

/**
 * An in-memory core + redirect handler for tests. `defaultDomain` defaults to
 * `"sho.rt"`. Background writes are awaited by {@link TestLinks.flush}.
 *
 * @example
 * ```ts
 * const { core, redirects, flush, events } = createTestLinks();
 * const link = await core.createLink({ url: "https://example.com", slug: "x" });
 * const res = await redirects.fetch(clickRequest("https://sho.rt/x"));
 * await flush(); // events now holds the click
 * ```
 */
export function createTestLinks(options: TestLinksOptions = {}): TestLinks {
  const storage = createMemoryStorage();
  const collecting = createCollectingSink();
  const sink = options.analytics ?? collecting;
  const { redirect, analytics: _a, ...coreOptions } = options;
  const core = createLinksCore({
    storage,
    analytics: sink,
    defaultDomain: "sho.rt",
    counterFlushMs: 0,
    ...coreOptions,
  });
  const pending: Promise<unknown>[] = [];
  const redirects = createRedirectHandler({
    core,
    ingestor: { flushIntervalMs: 0, batchSize: 1_000_000 },
    resolver: { ttlMs: 0 },
    privacy: { salt: "test" },
    ...redirect,
  });
  const wrapped: RedirectHandler = {
    ...redirects,
    handle: (request, ctx) =>
      redirects.handle(request, { waitUntil: (p) => void pending.push(p), ...ctx }),
    fetch: (request, ctx) =>
      redirects.fetch(request, { waitUntil: (p) => void pending.push(p), ...ctx }),
  };
  return {
    core,
    storage,
    redirects: wrapped,
    sink,
    events: collecting.collected,
    async flush() {
      while (pending.length) await Promise.all(pending.splice(0));
      await redirects.ingestor?.flush();
      await core.flushCounters();
    },
  };
}

/** A few real user agents. */
export const USER_AGENTS = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  android:
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  ipad: "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  slackbot: "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  twitterbot: "Twitterbot/1.0",
  curl: "curl/8.7.1",
} as const;

/** Options for {@link clickRequest}. */
export interface ClickRequestOptions {
  userAgent?: string;
  country?: string;
  city?: string;
  referrer?: string;
  language?: string;
  ip?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
}

/** Build a redirect request with realistic headers. Defaults: macOS Chrome, US. */
export function clickRequest(url: string, options: ClickRequestOptions = {}): Request {
  const headers = new Headers(options.headers);
  headers.set("user-agent", options.userAgent ?? USER_AGENTS.macChrome);
  if (options.country !== "") headers.set("cf-ipcountry", options.country ?? "US");
  if (options.city) headers.set("cf-ipcity", options.city);
  if (options.referrer) headers.set("referer", options.referrer);
  headers.set("accept-language", options.language ?? "en-US,en;q=0.9");
  headers.set("x-real-ip", options.ip ?? "203.0.113.7");
  return new Request(url, {
    method: options.method ?? "GET",
    headers,
    ...(options.body ? { body: options.body } : {}),
  });
}
