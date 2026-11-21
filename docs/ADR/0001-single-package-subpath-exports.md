# ADR 0001 — Single Package with Subpath Exports

**Status:** Accepted (mirrors `@xtandard/flags` and `@xtandard/webhooks` ADR 0001)

---

## Context

`@xtandard/links` ships a large surface: a control-plane core, a redirect handler, click ingestion,
an analytics-sink port with several adapters (KV rollups, ClickHouse, Tinybird, Workers Analytics
Engine), deep-link helpers, QR codes, CSV import, storage adapters (memory, file, Redis, Postgres,
Drizzle, MongoDB, SQLite, libSQL, unstorage, Cloudflare KV), auth and authorization providers,
framework adapters (Elysia 1/2, Hono, Express, Bun, Next), a bundled admin SPA, React embeds, ecosystem
bridges and test helpers. Many pull in optional peers (`redis`, `pg`, `mongodb`, `drizzle-orm`,
`elysia`, `react`, …).

The constraints are the siblings':

- The redirect path (`createRedirectHandler`) and the click pipeline must have **zero optional
  dependencies** — they run on edge runtimes.
- Optional peers must not be resolved unless the consumer imports the subpath that needs them.
- Consumers install one package and choose what they wire up.

## Decision

Ship `@xtandard/links` as a **single npm package with explicit subpath exports** mapping to thin
`entry-*.ts` re-export entrypoints, built by vite-plus (`vp pack`) into dual ESM/CJS bundles with
`.d.mts`/`.d.cts` declarations — the mechanism proven in flags and webhooks.

Every new subpath requires four edits, or CI-only failures appear: `src/entry-*.ts`,
`vite.config.ts` `pack.entry`, `package.json` `exports`, and `examples/tsconfig.json` `paths`.

## Consequences

- One version number, one release pipeline, one README.
- Missing optional peers fail at import time with an actionable `requirePeer` message.
- The exports map is large but mechanical; `publint` guards it in CI.
