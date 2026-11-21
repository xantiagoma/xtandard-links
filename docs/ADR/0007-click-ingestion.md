# ADR 0007 — Click Ingestion: Async Batching, Enrichment, Privacy

**Status:** Accepted (★ new; the closest sibling is webhooks' fire-and-forget `onDelivery`)

---

## Context

Every redirect produces a click. Writing synchronously would put the sink's latency on the
redirect; dropping silently would make analytics untrustworthy. Clicks also need enrichment (bot?
device? country?) and privacy controls (GDPR: IPs are personal data).

## Decision

1. `createClickIngestor({ sink, batchSize = 100, flushIntervalMs = 1000, maxQueue = 10000, retry,
onError, onDrop })`: `capture(event)` enqueues synchronously; batches flush on size or interval
   with bounded exponential retry. When the queue is full the oldest events are dropped **and
   `onDrop` fires** (analytics is best-effort; the redirect is not — the opposite stance of
   `@xtandard/audit`, deliberately). `flush()` / `close()` drain for graceful shutdown.
2. Edge mode: `capture(event, { waitUntil })` flushes immediately in the background via the
   runtime's `waitUntil` (Workers, Vercel), because isolates freeze between requests.
3. Enrichment, all zero-dependency and replaceable:
   - **bots**: a built-in user-agent pattern list (crawlers, link-preview unfurlers, monitoring,
     headless browsers, HTTP libraries) — `isBot(ua)`; plus `isPreviewBot(ua)` for unfurlers. Policy
     `bots: "flag" | "drop"` (default `flag`: recorded with `bot: true` and excluded from default
     metrics);
   - **UA**: a small built-in parser → `device` (desktop/mobile/tablet/bot/tv/console/unknown),
     `os`, `browser`; replaceable with `parseUserAgent` (e.g. `ua-parser-js`);
   - **geo**: a `GeoResolver` port; built-ins read edge headers (`cloudflareGeo` — `CF-IPCountry` +
     `request.cf`; `vercelGeo` — `x-vercel-ip-*`; `headerGeo({...})` generic); MaxMind via a
     user-supplied function (example provided);
   - **referrer**: full URL + host; `?ref=` fallback;
   - **QR**: `?qr=1` marks scans from generated QR codes (stripped from the destination).
4. Privacy: `privacy: { ip: "drop" | "truncate" | "hash" | "full" (default "drop"),
visitor: "daily-hash" | "none", respectDnt: boolean }`. `daily-hash` = SHA-256(ip + ua + tenant
   - daily salt), salt rotating from a secret, so uniques are countable within a day without
     storing IPs.
5. A fire-and-forget `onClick` tap (like `onDelivery`) observes every captured event.

## Consequences

- Hard crashes can lose the in-memory batch (documented; `flushIntervalMs` bounds the loss).
- Defaults are privacy-preserving: no raw IP stored unless the host opts in.
