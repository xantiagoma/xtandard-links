# react-embed × @xtandard/links

Embed links **inside your own React app**:

- **`<LinkAnalytics>`** — the customer-facing analytics widget. Each customer sees
  only _their_ links' clicks, scoped by a short-lived **viewer token** your backend
  mints.
- **`<LinksDashboard>`** — the full links admin for your operators, using the
  panel's own auth.

```tsx
import { LinkAnalytics, LinksDashboard } from "@xtandard/links/react";
import "@xtandard/links/react/styles.css";

// token = an lvt_… viewer token your backend minted with createViewerToken()
<LinkAnalytics apiBaseUrl="/links" token={token} />
<LinksDashboard apiBaseUrl="/links" />
```

`react` + `react-dom` are peers. Build the package at the repo root first
(`bun run build`).

## What's here

- **`start.ts`** — boots an in-memory panel on **:3702** at `/links` with
  `portal: { secret }`, seeds three links for tenant `acme` and sends 60 clicks
  (assorted devices, countries and referrers) through the real redirect handler.
  It also serves **`POST /viewer-token`**, standing in for the _host app's_
  session-guarded route that calls `createViewerToken(secret, { tenant })`. The
  secret never reaches the browser.
- **A Vite React host app** on **:5191** — proxies `/links` and `/viewer-token` to
  the demo server (same-origin, like your own backend), fetches a token and renders
  the components.

The token rides as `Authorization: Bearer lvt_…`. To call the panel cross-origin
instead, point `apiBaseUrl` at it and set the panel's `cors` option.

## Run it

```bash
# from the repo root — boots the seeded panel on :3702 + the vite host app:
bun run examples:react-embed          # → http://localhost:5191

# or manually, in this directory:
bun install
bun run start
```

## Verify the scoping from outside

```bash
TOKEN=$(curl -s -X POST localhost:3702/viewer-token | jq -r .token)
curl -s -H "authorization: Bearer $TOKEN" 'localhost:3702/links/api/tenants/acme/analytics?groupBy=country' | jq .totals
curl -s -o /dev/null -w '%{http_code}\n' -H "authorization: Bearer $TOKEN" \
  localhost:3702/links/api/tenants/default/links        # 403: another tenant
```
