# PLAN — `@xtandard/links`

> Self-hosted, embeddable branded short links, click analytics, conversion attribution and deep
> links — as a library. The Dub / Bitly niche, in the exact shape of `@xtandard/flags` and
> `@xtandard/webhooks`.

Single source of truth for _what we are building and in what order_. Day-to-day status lives in
[WORKLOG.md](./WORKLOG.md). The brief is [MISSION.md](./MISSION.md); the market research is
[docs/research/landscape.md](./docs/research/landscape.md); decisions are in [docs/ADR](./docs/ADR).

## North star

- **The redirect is sacred.** `GET /{slug}` lives in the host's hottest path. It answers from memory
  when it can, never waits on the analytics sink, never throws into the host, and keeps serving the
  last known good link when storage hiccups (ADR 0002).
- **Your database, your process.** `bun add` + the storage you already run. Links, domains and
  attribution live in the same pluggable KV floor as flags/webhooks; analytics go through a
  **separate sink port** so the same DB works on day one and ClickHouse / Tinybird / Workers
  Analytics Engine take over at scale (ADR 0005, 0006).
- **Links as a feature of someone else's SaaS.** Everything is tenant-scoped; the admin UI and a
  per-tenant analytics widget (scoped, stateless tokens) embed in the host app (ADR 0003, 0009).
- Batteries included, not required: every official piece implements a public contract (storage,
  analytics sink, geo resolver, UA parser, auth, authorization, hooks).

## Reference repos and how closely we mirror them

| Area               | Mirrors                                                               | Notes                                                                   |
| ------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Package layout     | webhooks: `src/entry-*.ts` + `exports` + `vp pack` dual ESM/CJS       | ADR 0001                                                                |
| Storage drivers    | the same 10 drivers, same factory names/options, `requirePeer`        | KV contract verbatim; slug pointers use `compareAndSwap` when present   |
| Server             | `createFetchHandler` → `{ fetch, core, openapi }`, router, OpenAPI    | + a **separate redirect handler** (`createRedirectHandler`) ★ ADR 0004  |
| Auth/authorization | `auth/{none,basic,delegated}`, `authorization/{none,roles,delegated}` | links-specific action set                                               |
| Portal             | webhooks portal tokens (HMAC, stateless)                              | tenant-scoped **analytics viewer tokens**, optional link filter ★ 0009  |
| UI                 | same SPA stack, tokens, primitives, theme, toasts; `react` embeds     | `<LinksDashboard>` + `<LinkAnalytics>` widget                           |
| Hooks              | `before` (veto) / `after` (side effects) around admin mutations       | clicks get a fire-and-forget `onClick` tap (like `onDelivery`)          |
| Adapters           | `{elysia,elysia2,hono,express,bun}` exporting `linksPanel`            | + `linksRedirect` per framework, + `next` (middleware/route handlers) ★ |
| CLI                | `bin/xtandard-links.mjs` → `dist/cli`                                 | serve / create / list / import / export / stats / qr / domains          |
| Tests              | vitest projects (core + elysia2), `*.bun.test.ts`, conformance        | storage **and** analytics-sink conformance suites; playwright e2e; tsd  |
| Docs               | README sections, `docs/*.md`, ADRs, CHANGELOG (changelogen)           | Starlight site in `site/` + `pages.yml`                                 |
| Release            | `release.yml` (tag push → npm trusted publishing/OIDC)                | identical flow                                                          |

## Domain model (summary — `src/schema.ts` is authoritative)

```ts
interface Link {
  id: string; // "lnk_" + time-sortable id
  tenant: string; // owning workspace/customer ("default" for single-tenant hosts)
  domain: string; // hostname, e.g. "go.acme.com"
  slug: string; // as written; matching is case-insensitive unless the domain says otherwise
  url: string; // default destination
  title?: string;
  description?: string;
  tags: string[];
  externalId?: string;
  expiresAt?: string;
  expiredUrl?: string;
  maxClicks?: number; // expiry → expiredUrl or 410
  password?: PasswordHash; // PBKDF2 (Web Crypto); never returned by the API
  utm?: Utm; // merged into the destination query
  og?: { title?; description?; image? }; // link-preview overrides served to unfurlers
  rules: LinkRule[]; // ordered: first match wins; each rule → url or weighted variants (A/B)
  ios?: string;
  android?: string; // app/store destinations per platform (deep links, ADR 0008)
  deepLink?: { path: string; deferred?: boolean };
  redirect?: 301 | 302 | 307 | 308; // default 302
  trackConversions?: boolean; // append the click id param to the destination
  passQuery?: boolean; // forward the short URL's query string (default true)
  disabled?: boolean;
  archived?: boolean;
  metadata?: JsonObject;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}
interface LinkRule {
  id: string;
  when: Condition[]; // ANDed: device | os | browser | country | continent | language |
  //                     referrer | query | time window | qr (scanned)
  url?: string;
  variants?: { url: string; weight: number }[];
}
interface Domain {
  hostname: string;
  tenant?: string; // undefined = shared by every tenant
  rootUrl?: string;
  notFoundUrl?: string;
  caseSensitive?: boolean;
  slugLength?: number;
  apps?: {
    ios?: { appIds: string[]; paths?: string[] };
    android?: { packageName; sha256: string[] }[];
  };
  verified?: boolean;
}
interface ClickEvent {
  type: "click";
  id: string; // "clk_…" — also the attribution id handed to the destination
  at: string;
  tenant;
  linkId;
  domain;
  slug;
  destination;
  ruleId?;
  variant?;
  country?;
  region?;
  city?;
  continent?;
  device;
  os;
  browser;
  referrer?;
  referrerHost?;
  ip?: string /* per privacy mode */;
  visitor?: string /* daily-salted hash */;
  bot: boolean;
  qr: boolean;
  utm?: Utm;
}
interface LeadEvent {
  type: "lead";
  id;
  at;
  tenant;
  linkId;
  clickId;
  customerId;
  name;
  metadata?;
}
interface SaleEvent {
  type: "sale";
  id;
  at;
  tenant;
  linkId;
  clickId;
  customerId;
  name;
  amount: number /* minor units */;
  currency: string;
  invoiceId?;
  metadata?;
}
```

Control data (storage): tenants, domains, links, slug pointers, tags (derived), customers
(customer → click attribution), deferred deep-link handoffs, the internal operator audit log.
Analytics data (sink): click / lead / sale events and their rollups.

## Module layout

```txt
src/
  index.ts            root: core, schema, contracts, handlers, tokens
  schema.ts           types
  core.ts             createLinksCore: tenants, domains, links CRUD, slugs, import/export,
                      conversions (trackLead/trackSale), customers, deferred deep links, audit log
  validation.ts       valibot validation (admin + import paths)
  id.ts slug.ts       time-sortable ids, slug generation/normalization, reserved slugs
  keys.ts             KV key layout
  rules.ts            condition evaluation + weighted variant selection (deterministic)
  destination.ts      UTM merge, query pass-through, click-id param, deep-link/store routing
  resolver.ts         memory-first link cache (LRU + TTL + negative cache + LKG + watch)
  redirect.ts         createRedirectHandler: resolve → rules → password/expiry/preview → Response;
                      .well-known (AASA / assetlinks); waitUntil-aware click capture
  clicks/             ingestor (async batching, retry, fallback), bot detection, UA parsing,
                      geo resolvers (headers: cloudflare/vercel/fastly/generic), privacy modes
  analytics/          sink contract + query model; kv rollup sink (default, same DB); memory sink;
                      clickhouse, tinybird, analytics-engine adapters
  conversions.ts      click-id param, customer attribution, client helper (`/client` subpath)
  deeplinks.ts        AASA + assetlinks builders, platform routing, deferred handoff matching
  qr.ts               QR code SVG/PNG-data-URL (uqr)
  csv.ts import.ts    RFC 4180 CSV, bulk import (native, Bitly, Dub, Shlink, Kutt column maps)
  portal.ts           analytics viewer tokens (stateless HMAC, tenant-scoped, optional link set)
  bridges/            webhooks (publish link/click/lead/sale events), audit (record admin changes)
  testing.ts          in-memory core + collecting sink + request builders
  storage/ drizzle/ auth/ authorization/ hooks/ server/ adapters/   (mirrors webhooks)
  ui/                 React SPA → dist/ui (admin + analytics-widget chrome)
  react.tsx           <LinksDashboard>, <LinkAnalytics>
  cli.ts              xtandard-links CLI
apps/standalone/      Bun server (panel + redirect) + Dockerfile
examples/             hono, elysia, express, bun, next, cloudflare-workers (KV + Analytics Engine),
                      react-embed (dashboard + widget), conversions, deep-links, storage-drivers
site/                 Starlight docs site
```

## Phases

Status 2026-11-21: phases 1–7 done (see WORKLOG.md); v0.1.0 awaits the owner's first npm publish.

1. **Research gate** — `docs/research/landscape.md`, verdict to t1r. ✅
2. **Design** — this file + ADRs 0001–0012, report to t1r. ✅
3. **Scaffold** — tooling copied from webhooks (scripts, vite-plus, oxlint/oxfmt, tsconfigs, husky,
   mise, CI, release, LICENSE, CLAUDE.md). GitHub repo `xantiagoma/xtandard-links` created.
4. **Spine** (lead) — schema, ids, slugs, keys, validation, storage contract + memory driver, core,
   rules, destination, resolver, redirect handler, click pipeline, analytics contract + KV rollup
   sink + memory sink, conversions, storage + sink conformance suites. Unit tests.
5. **Fan-out** (workers in worktrees, disjoint files):
   - A. storage drivers (file, redis, postgres, drizzle + table helpers, mongodb, sqlite, libsql,
     unstorage, cloudflare-kv, watch) + conformance across drivers;
   - B. server: admin routes, OpenAPI, portal tokens, auth/authorization providers, framework
     adapters (panel + redirect) incl. `next`, CLI, standalone app;
   - C. analytics adapters (ClickHouse, Tinybird, Analytics Engine), deep links (`.well-known`,
     deferred), QR, CSV import mappers, bridges (webhooks, audit), examples;
   - D. UI SPA + React embeds (dashboard + analytics widget) + playwright e2e (after B's API).
6. **Docs** — README (+ ecosystem section), `docs/*.md`, CHANGELOG, site + `pages.yml`, Pages live.
7. **Release prep** — `release.yml`, publint, `npm pack --dry-run`, READY TO PUBLISH to t1r,
   sibling ecosystem-table lines.

## Scope tiers

- **MVP (must):** core + rules + redirect plane + click ingestion (bots / UA / geo headers / privacy)
  - KV rollup analytics + 10 storage drivers + admin API + UI + analytics widget + adapters + CLI.
- **Second (must, after MVP):** conversions (trackLead / trackSale + client helper), deep links
  (AASA / assetlinks / store fallback / deferred), QR, bulk import, ClickHouse / Tinybird /
  Analytics Engine sinks, webhooks + audit bridges.
- **Out of scope v0:** domain DNS/TLS provisioning (the host owns its edge), link-in-bio pages,
  partner/affiliate payouts, MaxMind DB parsing in-core (pluggable `GeoResolver`; an example shows
  `maxmind` wired in), Vercel Edge Config source (documented recipe instead of an adapter).

## Definition of done

See MISSION.md and the ecosystem rules. Gate: `bun run check && bun run test && bun run test:bun &&
bun run test:e2e` green locally and in GitHub Actions.

## ADR index (★ = deviation from flags/webhooks)

| ADR  | Decision                                                                            |
| ---- | ----------------------------------------------------------------------------------- |
| 0001 | Single package, subpath exports (mirrors)                                           |
| 0002 | Redirect-plane independence: memory-first resolver, LKG, never blocks or throws ★   |
| 0003 | Bundled SPA UI + React embeds (mirrors)                                             |
| 0004 | Two handlers: admin panel vs redirect handler; fall-through composition ★           |
| 0005 | Storage = KV contract; slug pointers + CAS uniqueness; links per tenant ★           |
| 0006 | Analytics is a separate sink port; KV rollups by default, OLAP adapters for scale ★ |
| 0007 | Click ingestion: async batching, bot/UA/geo, privacy modes, edge `waitUntil` ★      |
| 0008 | Deep links: per-domain `.well-known`, platform routing, deferred handoff ★          |
| 0009 | Analytics viewer tokens (portal tokens, tenant + optional link scope) ★             |
| 0010 | Conversion attribution: click id param, customers, trackLead / trackSale ★          |
| 0011 | Rules engine: ordered conditions, deterministic weighted variants ★                 |
| 0012 | Slugs: case-insensitive by default, generated alphabet, reserved words ★            |
