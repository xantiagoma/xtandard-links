# ADR 0008 — Deep Links: `.well-known`, Platform Routing, Deferred Handoff

**Status:** Accepted (★ new; fills the Firebase Dynamic Links vacuum — see the landscape)

---

## Context

Firebase Dynamic Links shut down on 2025-08-25. Replacements are hosted (Branch, AppsFlyer, Dub).
Deep links need three pieces: OS-level association files on the short domain, per-platform routing
for users without the app, and _deferred_ deep linking (open the right screen after install).

## Decision

1. **Association files** per domain from `Domain.apps`: the redirect handler serves
   `/.well-known/apple-app-site-association` (`applinks.details[].appIDs` + `components`, from
   `apps.ios`) and `/.well-known/assetlinks.json` (`delegate_permission/common.handle_all_urls`, from
   `apps.android`), `content-type: application/json`, no redirect. Pure builders are exported
   (`buildAppleAppSiteAssociation`, `buildAssetLinks`) for hosts serving them elsewhere.
2. **Platform routing**: if the app is installed, the OS opens it via the universal/app link before
   the server sees the request. Requests that do reach the server from iOS / Android go to
   `link.ios` / `link.android` (typically the store listing) when set, before rules; the Play
   Store URL gets `&referrer=xl_id%3D{clickId}` appended so the installed app can read the click id
   from the Install Referrer API.
3. **Deferred handoff** (`link.deepLink.deferred`): on a mobile click the core stores a short-lived
   handoff (`ttl` default 2 h) keyed by click id and by a coarse fingerprint (daily-hashed IP +
   OS family). On first open the app calls `POST /api/deferred/claim` with `{ clickId }` (exact:
   Android install referrer / iOS pasteboard) or nothing (probabilistic: fingerprint match, newest
   within the window, `matchType: "probabilistic"` in the response). A handoff is claimable once.
4. No SDKs: the claim endpoint is a plain JSON call; the docs show Swift/Kotlin snippets.

## Consequences

- Hosts get universal links on their own short domain with no third party.
- Probabilistic matching is opt-in per link and clearly labelled; IPs are never stored raw.
