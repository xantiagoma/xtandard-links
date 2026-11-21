# cloudflare-workers × @xtandard/links

Short links at the edge: a Worker answers redirects from an in-isolate cache over
**Workers KV**, records clicks to **Workers Analytics Engine** after the response
(`ctx.waitUntil`), and enriches them with `request.cf` geo (`cloudflareGeo()`).
The admin JSON API runs in the same Worker under `/links`.

```ts
const core = createLinksCore({
  storage: createCloudflareKvStorage({ namespace: env.LINKS }),
  analytics: createAnalyticsEngine({
    dataset: env.LINKS_ANALYTICS,
    datasetName: "links_events",
    accountId,
    apiToken,
  }),
  defaultDomain: env.LINKS_DOMAIN,
});
const redirects = createRedirectHandler({
  core,
  geo: cloudflareGeo(),
  ingestor: { flushIntervalMs: 0 },
});

export default {
  fetch: (request, env, ctx) => redirects.fetch(request, { waitUntil: (p) => ctx.waitUntil(p) }),
};
```

## Bindings (`wrangler.toml`)

| Binding           | Kind                     | Holds                                               |
| ----------------- | ------------------------ | --------------------------------------------------- |
| `LINKS`           | KV namespace             | links, domains, attribution refs, deferred handoffs |
| `LINKS_ANALYTICS` | Analytics Engine dataset | click / lead / sale events                          |

Secrets: `CF_ACCOUNT_ID` + `CF_ANALYTICS_TOKEN` (Account Analytics: Read) let the
admin API query analytics through the Analytics Engine SQL API;
`LINKS_ADMIN_TOKEN` guards `/links/*` (no token → closed).

## Notes

- **API-only panel.** The panel serves its UI from the filesystem, which a Worker
  doesn't have, so `/links` is the JSON API (plus `nodejs_compat` for its imports).
  Run the UI from a Node/Bun origin over the same KV namespace, or manage links
  with the API / CLI.
- **KV is eventually consistent** (up to ~60s across locations) and not watchable,
  so the resolver re-checks cached links on a TTL (`resolver.ttlMs`).
- **Analytics Engine** stores raw events; the dashboard's queries run as SQL over
  the dataset and support cross-filtering.

## Run it

```bash
# build the package once at the repo root: bun run build
bun install
bunx wrangler dev          # http://localhost:8787 — local KV, no account needed
```

```bash
# with LINKS_ADMIN_TOKEN=dev in .dev.vars and LINKS_DOMAIN=localhost:
curl -s -X POST localhost:8787/links/api/tenants/default/links \
  -H 'authorization: Bearer dev' -H 'content-type: application/json' \
  -d '{"slug":"hi","url":"https://example.com"}'
curl -i localhost:8787/hi
```

In this repository the Worker is type-checked with the other examples
(`bun run typecheck:examples`); it is not deployed by CI.
