# ADR 0003 — Bundled SPA UI + React Embeds

**Status:** Accepted (mirrors webhooks ADR 0003)

---

## Context

Links need an admin surface (links, domains, rules editor, QR codes, bulk import, analytics charts)
and a **per-tenant analytics widget** the host shows its own customers. Options mirror flags and
webhooks: server-rendered templates, React components only, or a bundled prebuilt SPA served by the
package's own fetch handler.

## Decision

Bundle a prebuilt React SPA (React 19, Tailwind v4, TanStack Query, wouter — the sibling stack) into
`dist/ui`, served by `createFetchHandler` with `__LINKS_CONFIG__` and `<base>` injection so it mounts
under any base path. The same bundle renders two chromes: the full admin dashboard, and the reduced
**analytics widget** chrome when `/config` reports a viewer-token principal (ADR 0009) — no second SPA.

A separate ESM React build (`@xtandard/links/react`) exposes `<LinksDashboard>` and
`<LinkAnalytics>` for hosts that render inside their own React tree; React is an optional peer
there. CSS is scoped under `.xtandard-links` (same post-build scoping script as the siblings).

Charts are hand-rolled SVG (bars, sparkline, timeseries) — no chart library in the bundle.

## Consequences

- `bun add @xtandard/links` + one mount line yields a working admin UI in any supported framework.
- Same tokens and primitives as flags/webhooks: one product line.
