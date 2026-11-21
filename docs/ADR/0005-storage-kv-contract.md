# ADR 0005 — Storage = KV Contract, Slug Pointers, CAS Uniqueness

**Status:** Accepted (★ extends flags/webhooks ADR 0005 with a key layout for links)

---

## Context

The product promise is "point it at the database you already run". Flags and webhooks proved a
four-method KV contract (`getItem`, `setItem`, `removeItem`, `getKeys`) plus feature-detected
capabilities (`watch`, `transaction`, `compareAndSwap`) ports to ten backends nearly mechanically.

Links add two requirements: **global slug uniqueness per domain** (two tenants creating `go.acme.com/
sale` at once must not both win) and a **one-read redirect lookup**.

## Decision

1. Keep `LinksStorage` = the sibling contract verbatim, with the same capability interfaces and
   `requirePeer` helper; the 10 drivers port with renames.
2. Key layout (`src/keys.ts`):

   ```txt
   lnk/tenants                         -> string[] index
   lnk/t/{tenant}/meta                 -> Tenant
   lnk/domains                         -> string[] index (hostnames)
   lnk/domains/{hostname}              -> Domain
   lnk/s/{hostname}/{slugKey}          -> SlugPointer { tenant, id }  (the redirect lookup)
   lnk/t/{tenant}/links/{id}           -> Link
   lnk/t/{tenant}/ext/{externalId}     -> link id
   lnk/t/{tenant}/customers/{id}       -> Customer (conversion attribution)
   lnk/clicks/{clickId}                -> ClickRef (attribution window; pruned by retention)
   lnk/deferred/{fingerprint}          -> DeferredHandoff[] (short TTL)
   lnk/t/{tenant}/audit-log            -> AuditEntry[]
   ```

   `slugKey` is the normalized slug (ADR 0012), URI-component-encoded.

3. Slug claims use `compareAndSwap({ expected: null })` when the storage supports it (memory, redis,
   postgres, sqlite, libsql, drizzle, mongodb); otherwise read-then-write with a re-read check
   (single-writer assumption, documented — the same stance as webhooks' plain-KV dispatcher).
4. The resolver reads `lnk/s/...` then `lnk/t/.../links/{id}` (two reads, cached per ADR 0002).
5. Analytics never go through this contract except via the default KV rollup sink (ADR 0006).

## Consequences

- Every sibling driver ports; only key prefixes change.
- Listing a tenant's links scans `lnk/t/{tenant}/links/` (fine at library scale; the UI paginates in
  memory per tenant). A secondary index per tag is not kept; tag filtering is a scan.
