# Testing

Both what the package ships for testing _your_ short-link wiring, and how this repository is
tested.

## Testing your app: `@xtandard/links/testing`

```ts
import { clickRequest, createTestLinks, USER_AGENTS } from "@xtandard/links/testing";
import { expect, test } from "bun:test"; // or vitest

test("German iPhone users get the German page", async () => {
  const { core, redirects, flush, events } = createTestLinks();
  await core.createLink({
    slug: "app",
    url: "https://acme.com/download",
    rules: [
      {
        when: [{ field: "country", op: "in", values: ["DE"] }],
        url: "https://acme.de/download",
      },
    ],
  });

  const res = await redirects.fetch(
    clickRequest("https://sho.rt/app", { userAgent: USER_AGENTS.iphone, country: "DE" }),
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://acme.de/download");

  await flush(); // background click capture, counters and attribution writes
  expect(events[0]).toMatchObject({ type: "click", country: "DE", os: "ios", device: "mobile" });
});
```

- **`createTestLinks(options?)`**: an in-memory core (`defaultDomain: "sho.rt"`) and redirect
  handler, deterministic for tests: the resolver cache is off (`ttlMs: 0`, every edit is visible
  immediately), the ingestor has no timer, counters flush on demand, and the privacy salt is fixed
  (`"test"`) so visitor hashes and A/B arms are stable. Returns `{ core, storage, redirects, sink,
events, flush }`; `flush()` awaits every background write and drains the ingestor, `events` is
  every event the built-in collecting sink received (empty when you pass your own `analytics`).
  Pass core options (`now`, `hooks`, `reservedSlugs`, …), `redirect`
  options (`privacy`, `bots`, `conversions`, `onClick`, …) or your own `analytics` sink.
- **`clickRequest(url, options?)`**: a realistic redirect request. Defaults: macOS Chrome, country
  `US` (sent as `CF-IPCountry`), `Accept-Language: en-US`, IP `203.0.113.7` (`X-Real-IP`).
  Options: `userAgent`, `country` (`""` for none), `city`, `referrer`, `language`, `ip`, `method`,
  `headers`, `body`.
- **`USER_AGENTS`**: `iphone`, `android`, `ipad`, `macChrome`, `windowsEdge`, `linuxFirefox`,
  `googlebot`, `slackbot`, `twitterbot`, `curl`.
- **`createCollectingSink()`**: a sink that keeps every event, for wiring your own core.

For analytics queries in tests, the memory sink (`@xtandard/links/analytics/memory`) implements the
reference semantics exactly, uniques included. Inject a clock with the core's `now` option to test
expiry, time-window rules and attribution windows without sleeping.

Testing conversions end to end: create the link with `trackConversions: true`, click it, `flush()`,
read the click id from the redirect's `location` (`xl_id`), then call `core.trackLead`.

## How this repository is tested

| Layer               | Where                                            | Notes                                                                                |
| ------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| unit + integration  | `test/*.test.ts` via `vp test run` (vitest)      | flat directory; `retry: 2` absorbs live-backend scheduling flakes                    |
| Elysia 2            | `test/elysia2.test.ts`, its own vitest project   | `elysia` aliased to the `elysia-v2` devDependency                                    |
| Bun-runtime-only    | `test/*.bun.test.ts` via `bun test`              | `bun:sqlite`, libSQL, `xtandard-links serve`                                         |
| storage conformance | `test/storage-contract.ts`                       | one battery, every driver (see [Storage](STORAGE.md#writing-your-own-driver))        |
| sink conformance    | `test/analytics-contract.ts`                     | one battery, every analytics sink, against the reference `aggregateEvents`           |
| live backends       | env-gated, see below                             | always-on locally where an in-process fake exists (pglite for Postgres / Drizzle-pg) |
| browser e2e         | `e2e/` via Playwright                            | builds the UI and the React embed, boots an in-memory server, drives the real SPA    |
| coverage            | `vp test run --coverage`, thresholds 90/80/88/90 | statements / branches / functions / lines; enforced in CI                            |

### The two conformance suites

`runStorageContractTests(name, makeStorage, { t, capabilities, seedLegacy? })` runs the
`@xtandard/kit/storage/testing` conformance suite (key root `lnk`) plus the links key-layout cases
against memory,
file, Postgres (pglite always, a real server with `POSTGRES_URL`), Drizzle over pglite, Drizzle
over MySQL (live), Redis and RedisJSON (the kit's fake client always, a live server with
`REDIS_URL` / `REDIS_JSON_URL`), MongoDB (live), SQLite and libSQL (Bun), unstorage, and a fake
Cloudflare KV binding.

`runAnalyticsContractTests(name, makeSink, options)` pins the analytics semantics (time ranges,
bucket alignment, zero-filled timeseries, breakdown ordering, `(none)` values, bot exclusion,
filters, conversions, uniques, raw events) with hand-computed expectations and against
`aggregateEvents`. Tests are gated by each sink's `capabilities`, so the KV sink skips
cross-filtering and uniques. It runs against the memory sink, KV rollups on memory storage, and,
with `CLICKHOUSE_URL`, against a live ClickHouse for the ClickHouse sink and for the SQL that the
Tinybird and Analytics Engine sinks generate (their HTTP calls are otherwise tested with a
recording mock `fetch`).

### Live backends

Tests that need a server skip unless its variable is set:

| Variable                                                                             | Enables                                          |
| ------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `REDIS_URL`                                                                          | Redis storage (live conformance, keyspace watch) |
| `REDIS_JSON_URL`                                                                     | RedisJSON storage (needs the JSON module)        |
| `POSTGRES_URL`                                                                       | Postgres storage against a real server           |
| `MONGO_URL`                                                                          | MongoDB storage                                  |
| `MYSQL_URL`                                                                          | Drizzle over MySQL                               |
| `CLICKHOUSE_URL` (+ `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE`) | ClickHouse sink; Tinybird / Analytics Engine SQL |

Locally, for example:

```sh
docker run -d -p 6379:6379 redis:7
docker run -d -p 8123:8123 -e CLICKHOUSE_PASSWORD=clickhouse clickhouse/clickhouse-server:24.8
REDIS_URL=redis://localhost:6379 \
CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_PASSWORD=clickhouse \
  bun run test
```

CI (`.github/workflows/ci.yml`) runs Redis 7, MongoDB 7, Postgres 16, MySQL 8 and ClickHouse 24.8
as service containers with all of these set, then `test:coverage`, `test:bun`, the build, `publint`
and a pack check. A second job runs the Playwright e2e suite.

### Conventions worth copying

- **Injectable clock**: the core, the KV sink and the resolver read `now()`; tests advance a fake
  clock instead of sleeping (expiry, TTLs, retention, attribution windows).
- **Injectable `fetch`**: the ClickHouse, Tinybird and Analytics Engine sinks take `fetch`, so
  their wire format is asserted request by request.
- **No timer assertions**: ingestors run with `flushIntervalMs: 0` and are flushed explicitly.
- **UI logic policy**: pure functions in `src/ui/lib/*` are unit-tested; everything visual goes
  through Playwright.

### The local gate

```sh
bun run check      # lint + format check + typecheck (also the pre-push hook)
bun run test       # vitest: unit, integration, conformance (live where configured)
bun run test:bun   # Bun-only tests
bun run test:e2e   # Playwright (builds the UI first)
```
