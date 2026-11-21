# Changelog

## v0.1.2

[compare changes](https://github.com/xantiagoma/xtandard-links/compare/v0.1.1...v0.1.2)

Security fix for the standalone server, the CLI and the Docker image: a mistyped `AUTH_MODE` no longer serves an open panel. Library APIs, storage and the HTTP API are unchanged.

### 🩹 Fixes

- **auth:** reject unknown `AUTH_MODE` instead of serving an open panel ([#19](https://github.com/xantiagoma/xtandard-links/pull/19)). Any value other than `none` or `basic` (a typo, wrong case) used to fall through to `none`, leaving the admin panel and API unauthenticated. The server now exits with `Unknown AUTH_MODE "x" (expected none or basic)` before it listens. An empty or unset `AUTH_MODE` still means `none`, and now prints the same unauthenticated-panel warning as an explicit `none`.

### Migration

None if `AUTH_MODE` is `none`, `basic` or unset. If a deployment fails to start after upgrading, its `AUTH_MODE` was invalid and the panel was open: set it to `basic` (with credentials) or `none` explicitly.

## v0.1.1

Branding in the shipped admin UI, widget and React embeds, plus brand, docs and tooling fixes. No
API, behavior or storage changes.

### Changed

- **ui:** the admin SPA, the viewer widget and the React embeds (`<LinksDashboard>`,
  `<LinkAnalytics>`) render the bare xtandard-links symbol per theme: `symbol.svg` on dark surfaces
  and the new `symbol-light.svg` (the light lockups' deeper lime) on light ones, inlined as data
  URLs. No square tile, and no assets to serve.
- **brand:** SVG-only logos wherever users see them (README, docs site, UI); the PNG logo variants
  are gone (`docs/assets/logo*.png`, `symbol.png`, `lockup-*.png`). Rasters remain only for the
  favicon set, the Apple touch icon and `social.png`. The docs home hero now uses the stacked
  lockups (light/dark), matching the other xtandard projects.

### Fixed

- **brand:** horizontal lockups are vertically centred with the shared xtandard rule (symbol centre
  = baseline - capHeight/2), so the symbol sits on the wordmark's optical centre in the navbar and
  the README header.
- **hooks:** the pre-commit hook no longer fails on commits that only touch formatter-ignored files
  (site `.mdx` pages, `CHANGELOG.md`).

### Documentation

- Docs site: Project status and Changelog pages; strict internal-link validation on every page.
- Ecosystem section (README, docs home and ecosystem page): adds `@xtandard/audit`,
  `@xtandard/entitlements` (with its npm link) and `@xtandard/xyte`.

### Migration

None. Drop-in from v0.1.0: no API, configuration, storage layout or analytics changes. If you
linked to the removed PNG logos in `docs/assets/` on GitHub, switch to the `.svg` files of the same
name.

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
