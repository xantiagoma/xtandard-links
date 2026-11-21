# Changelog

## v0.1.0

First release — self-hosted, embeddable branded short links as a library.

### Added

- **Core** (`createLinksCore`): tenants, domains (shared or tenant-owned, default domain, case
  sensitivity, `rootUrl`/`notFoundUrl`), links (generated or custom slugs incl. nested, tags,
  external ids, expiry + `expiredUrl`, `maxClicks`, PBKDF2 passwords, UTM templates, link-preview
  overrides, iOS/Android destinations, redirect status, query pass-through, archive/disable),
  bulk import with dry run and conflict policies, an operator audit log, `before`/`after` hooks.
- **Redirect plane** (`createRedirectHandler`): memory-first resolver (LRU + TTL +
  stale-while-revalidate + negative cache + last-known-good + watch invalidation), targeting
  rules with deterministic weighted A/B variants, password gate, Open Graph pages for unfurlers,
  `.well-known` association files, Play install referrer, deferred deep-link claim endpoint,
  fall-through composition, `waitUntil` support for edge runtimes. Never throws into the host.
- **Click ingestion**: async batched ingestor with retries and overflow reporting; bot and
  link-preview detection, user-agent parsing, geo from Cloudflare/Vercel/CloudFront/Fastly headers
  or a custom resolver, privacy modes (IPs dropped by default, daily-salted visitor hash, DNT/GPC).
- **Analytics sinks** behind one port and one conformance suite: KV rollups in the links storage
  (default), memory, ClickHouse, Tinybird and Workers Analytics Engine.
- **Conversions**: click ids on destinations, `@xtandard/links/client` capture helper,
  `trackLead` / `trackSale` (idempotent by invoice) with the click's dimensions.
- **Storage drivers**: memory, file, Redis (+ RedisJSON), Postgres, Drizzle (pg/mysql/sqlite table
  helpers), MongoDB, SQLite, libSQL, unstorage, Cloudflare KV — all passing the storage
  conformance suite (case-exact keys, literal prefixes).
- **Admin panel** (`createFetchHandler`): JSON API with OpenAPI 3.1, QR codes (SVG), CSV
  import/export (native, Bitly, Dub, Shlink, Kutt), auth (`none`, `basic`, `delegated`),
  authorization (`none`, `roles`, `delegated`), analytics **viewer tokens** for a per-tenant widget.
- **UI**: bundled admin SPA (links, link detail, analytics, domains, import, conversions, audit,
  rules editor), the viewer widget chrome, and React embeds `<LinksDashboard>` / `<LinkAnalytics>`.
- **Adapters**: Elysia (1 and 2, Eden-typed plugin), Hono, Express, Bun, Next.js — each with
  `linksPanel` and `linksRedirect`.
- **Bridges**: publish link/conversion (and optionally click) events to `@xtandard/webhooks`;
  record changes in `@xtandard/audit`.
- CLI (`xtandard-links serve | links | domains | import | export | stats | qr | prune`),
  standalone Docker image, examples, docs site, brand kit.
