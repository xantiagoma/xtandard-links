# WORKLOG — `@xtandard/links`

Reverse-chronological. Each entry: timestamp · task · files · tests · blocker · next.

---

## 2026-11-20 (evening) — spine, fan-out, brand

- Spine (lead): schema, ids (monotonic ULID-style), slugs, keys, validation, core (tenants, domains,
  links, import, counters, conversions, deferred handoffs, audit log), rules, destination, resolver
  (LRU/TTL/SWR/negative/LKG/watch), redirect handler (expiry, maxClicks, password, OG preview,
  platform routing, Play install referrer, .well-known, deferred claim, fall-through), click
  ingestor + enrichment (bots, UA, geo headers, privacy), KV rollup sink, /client, bridges.
- Workers merged: storage drivers (9 + watch), analytics sinks (memory, ClickHouse, Tinybird,
  Analytics Engine + conformance suite; KV sink made to pass it: exact deleteLink, partial-day
  series), server (panel API, OpenAPI, viewer tokens, auth/authz, adapters incl. next, CLI,
  standalone, QR, CSV import).
- Storage hardening after t1r reports: drizzle ESCAPE '!', MySQL utf8mb4_bin, exact-prefix
  post-filter on SQL drivers (SQLite LIKE folds case), file driver case-safe segment encoding,
  unstorage lossless escaping + string-prefix getKeys; conformance extended; live MySQL suite.
- Redirect: unknown slugs fall through in handle() unless the domain sets notFoundUrl.
- Brand kit generated (scripts/brand-assets.sh) + docs/BRAND.md.
- Running: UI (SPA, embeds, e2e, screenshots), docs + site, examples.
- Bun pinned to 1.4.4 (lockfile v2).

## 2026-11-20 — research gate + design + scaffold

- Research gate: `docs/research/landscape.md` (report + same-day re-verification). Verdict BUILD,
  sent to t1r.
- Design: `PLAN.md` + ADRs 0001–0012 (deviations from flags/webhooks marked ★).
- Scaffold: tooling copied from xtandard-webhooks and renamed (vite-plus, tsconfigs, husky, mise,
  CI/release/pages workflows, embed-CSS scoping, elysia2 types fix).
- t1r added to DoD: branding kit + docs/BRAND.md, real-UI Playwright screenshots (light/dark,
  admin/widget/embeds), docs preview via hc before Pages deploy.
- Next: spine (schema, storage contract + memory, core, resolver, redirect, clicks, analytics).
