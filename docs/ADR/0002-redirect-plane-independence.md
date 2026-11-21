# ADR 0002 — Redirect-Plane Independence

**Status:** Accepted (★ deviation: replaces webhooks ADR 0002 "delivery-plane independence";
borrows flags ADR 0002 "memory-first runtime evaluation")

---

## Context

Like its siblings, a link product has two workloads:

|                | Control plane                                  | Redirect plane                                               |
| -------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| Surface        | admin API + UI + analytics widget              | `GET /{slug}` on a branded domain                            |
| Traffic        | rare, human-driven                             | hot, anonymous, bursty (a viral link), bots                  |
| Guards         | auth, authorization, `before` hooks, audit log | none — but must never 500 and must never leak a stale delete |
| Failure stance | fail loudly to the operator                    | **always answer** (redirect, 404 page, or fall through)      |

Flags solved "hot path must not wait on storage" with a full in-memory snapshot. Links cannot load
every link into memory (a tenant may have millions), and a redirect must reflect edits within
seconds.

## Decision

1. The redirect handler resolves through a **memory-first resolver** (`createResolver`):
   - an LRU of compiled links keyed by `host/slug-key` (default 10 000 entries) with a TTL
     (default 60 s) and **stale-while-revalidate**: an expired entry is served immediately while one
     background refresh per key runs (request coalescing);
   - a **negative cache** (default 10 s) so random-slug scanning and bots do not hammer storage;
   - **last known good**: if storage throws, the last cached value is served (even past TTL) and the
     error goes to `onError`; with no cached value the handler answers the domain's `notFoundUrl` /
     a 404, never a 500;
   - **instant invalidation** when the storage is watchable (Redis keyspace, Postgres
     LISTEN/NOTIFY, memory, file): pointer and link keys evict their cache entries; otherwise core
     mutations made in the same process evict directly, and cross-process edits converge within the
     TTL;
   - optional `preload` (small installs) warms every link at start.
2. **Clicks never block the redirect.** The handler builds the click event synchronously from the
   request, hands it to the ingestor (ADR 0007) and returns. On edge runtimes the flush promise is
   passed to `waitUntil` when provided.
3. The analytics sink, admin panel and UI are optional at runtime: a redirect never depends on them.
4. Errors inside rules evaluation, geo/UA parsing or click capture degrade to the link's default
   destination and are reported via `onError`.

## Consequences

- Redirect latency is a Map lookup in the common case; storage is hit once per TTL per hot link.
- Edits from another process may take up to the TTL to show unless the storage is watchable; this
  is documented and the TTL is configurable (`0` disables caching for strict setups).
- Deletion of a cached link from another process without watch can serve up to TTL seconds longer;
  disabled/expired checks run on every request against the cached record, so expiry is exact.
