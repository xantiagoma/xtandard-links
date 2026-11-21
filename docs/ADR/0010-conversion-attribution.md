# ADR 0010 — Conversion Attribution: Click Id, Customers, trackLead / trackSale

**Status:** Accepted (★ new; the open equivalent of `@dub/analytics` + Dub's track API)

---

## Context

"Which link brought this signup / this sale?" is the reason teams pay for Dub. It needs a click id
that survives the redirect, a way to bind it to the host's customer, and events in the same sink
as clicks.

## Decision

1. When `link.trackConversions` is on (or globally via `conversions: { enabled: true }`), the
   redirect appends `xl_id={clickId}` (param name configurable) to the destination and stores a
   `ClickRef { clickId, tenant, linkId, at }` (pruned after `attributionWindow`, default 90 d).
2. The `@xtandard/links/client` subpath (zero-dep, browser) reads the param, persists it in a
   first-party cookie (`xl_id`, 90 d) and strips it from the address bar; `getClickId()` returns it so
   the host forwards it with its signup request.
3. Server-side: `core.trackLead({ clickId, customerId, name, metadata })` binds the customer to the
   click (`Customer { id, tenant, clickId, linkId, firstSeenAt }`) and ingests a `lead` event;
   `core.trackSale({ customerId, amount, currency, invoiceId?, name })` resolves the customer's
   click and ingests a `sale` event (idempotent on `invoiceId`). Unknown click ids → `null` result,
   not an error (attribution is best-effort).
4. HTTP: `POST /api/track/lead` and `/api/track/sale` on the panel, authorized by the
   `conversion:track` action (use a dedicated API-key principal via `auth/basic` or `delegated`).
5. Metrics: `leads`, `sales`, `saleAmount` (minor units, per currency in breakdowns) appear next to
   `clicks` in every analytics query.

## Consequences

- Attribution model is last-click per customer (first lead wins the binding); documented.
- No third-party cookies; the cookie is set on the host's own domain by the host's page.
