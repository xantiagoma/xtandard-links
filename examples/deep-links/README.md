# deep-links × @xtandard/links

Universal links / app links, store fallbacks and deferred deep links — one
script, no server, no phone:

1. register iOS and Android apps on a domain (`createDomain({ apps })`);
2. fetch `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`
   from the redirect handler, as the OS does;
3. click a link with `ios` / `android` store URLs and
   `deepLink: { path: "/product/42", deferred: true }` from a desktop, an iPhone and
   an Android phone — the Play Store URL carries the click id as the install referrer;
4. claim the handoff on "first open" with `POST /_links/deferred/claim`: exactly by
   click id (Android install referrer) or probabilistically by fingerprint (iOS);
5. claim again → `404 { matched: false }` (handoffs are single-use, and expire
   after `deferredTtl`, default 2h).

## Run it

```bash
# from the repo root (build once first: bun run build)
bun run examples:deep-links

# or in this directory
bun install
bun run start
```

In a real app the claim is an HTTP call from the app's first launch to your short
domain:

```http
POST https://go.acme.com/_links/deferred/claim
Content-Type: application/json

{ "clickId": "clk_…" }   // or {} to match by fingerprint
```

→ `{ "matched": true, "matchType": "exact", "path": "/product/42", "url": "…", "clickId": "…", "linkId": "…" }`.
See the Deep links guide for the iOS/Android sides.
