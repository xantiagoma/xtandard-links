# Analytics widget

Show each of your customers the clicks on _their_ links, inside your product. Your server mints a
short-lived, tenant-scoped **viewer token**; your frontend renders `<LinkAnalytics>` (or iframes the
bundled widget) with it. No panel accounts for your customers, no sessions, no proxy routes
(ADR [0009](ADR/0009-analytics-viewer-tokens.md)).

```mermaid
sequenceDiagram
  participant B as Customer's browser
  participant H as Your app (session-guarded route)
  participant P as Links panel (/links)
  B->>H: GET /dashboard/links (your auth)
  H->>H: createViewerToken(secret, { tenant: org.id })
  H-->>B: page with token
  B->>P: GET /links/api/tenants/{org}/analytics<br/>Authorization: Bearer lvt_…
  P->>P: verify HMAC + expiry, force-scope to the token's tenant
  P-->>B: { totals, timeseries, breakdown }
```

## 1. Enable viewer tokens on the panel

```ts
const panel = linksPanel({
  storage,
  basePath: "/links",
  auth, // your admin auth, unchanged
  portal: {
    secret: process.env.LINKS_VIEWER_SECRET!, // any long random string
    allow: ["analytics:read", "link:read"], // optional; the default for tokens that name none
  },
});
```

With `portal` set, a request bearing `Authorization: Bearer lvt_…` is authenticated as a **viewer**
instead of going through your `auth` provider. The standalone server and the CLI enable it with
`VIEWER_SECRET` ([Deployment](DEPLOYMENT.md)).

## 2. Mint a token server-side

```ts
import { createViewerToken } from "@xtandard/links";

// In a route your own auth protects:
app.get("/api/links-token", async (c) => {
  const org = await requireOrg(c);
  const token = await createViewerToken(process.env.LINKS_VIEWER_SECRET!, {
    tenant: org.id, // exactly one tenant
    links: undefined, // or ["lnk_…", …] to show only some links
    allow: undefined, // default: the panel's portal.allow, then analytics:read + link:read
    expiresIn: "1h", // default "1d"
  });
  return c.json({ token });
});
```

The token is `lvt_` + base64url(`{ tenant, links?, allow?, exp }`) + `.` + an HMAC-SHA256
signature: stateless, verified with Web Crypto, nothing stored. Never mint tokens in the browser:
anyone holding the secret can mint a token for any tenant. Admins can also mint tokens over HTTP
with `POST /api/tenants/:tenant/viewer-tokens` (action `viewer-token:create`; a minter can only
delegate actions it holds itself), see [HTTP API](HTTP_API.md#viewer-tokens).

## 3. Render the widget

### React

```tsx
import { LinkAnalytics } from "@xtandard/links/react";
import "@xtandard/links/react/styles.css";

export function LinksAnalyticsPage({ token }: { token: string }) {
  return <LinkAnalytics apiBaseUrl="/links" token={token} theme="inherit" />;
}
```

`<LinkAnalytics>` sends the token as a Bearer credential on every request; `/config` then reports
`viewer: true` and the component renders the reduced widget chrome, pinned to the token's tenant
(and links, when the token lists them). It takes the same props as `<LinksDashboard>`
([UI](UI.md)) except `initialTenant`:

| Prop          | Default         | Notes                                                                            |
| ------------- | --------------- | -------------------------------------------------------------------------------- |
| `token`       | required        | the `lvt_…` viewer token                                                         |
| `apiBaseUrl`  | `""`            | where the panel is mounted (`"/links"`, or another origin)                       |
| `theme`       | `"auto"`        | `"auto"` (own switcher), `"inherit"` (follow the host page), `"light"`, `"dark"` |
| `credentials` | `"same-origin"` | fetch credentials mode                                                           |
| `fetch`       | global `fetch`  | extra headers or instrumentation                                                 |
| `routing`     | `"hash"`        | `"hash"`, `"browser"`, `"memory"` or a wouter location hook                      |
| `routerBase`  | —               | with `routing: "browser"`                                                        |
| `queryClient` | created         | bring your own TanStack `QueryClient`                                            |
| `className`   | —               | on the root wrapper                                                              |
| `logoUrl`     | from `/config`  | navbar logo                                                                      |

Styles are scoped under `.xtandard-links`, so they do not leak into your page. `react` and
`react-dom` (18 or 19) are optional peers of the package, needed only for this subpath.

Tokens expire: refetch one from your route before `exp` (or when a request answers `401
VIEWER_TOKEN`) and re-render with the new `token`.

### Without React

The bundled SPA accepts the token in the query string and renders the same widget chrome, so an
iframe works anywhere:

```html
<iframe src="/links/?token=lvt_…" style="width: 100%; height: 640px; border: 0"></iframe>
```

The token is then visible in the iframe URL (and your server's access logs): keep `expiresIn`
short.

### Cross-origin

When the panel runs on another origin than your app, enable CORS on the panel (`cors` option,
[Adapters](ADAPTERS.md)) and point `apiBaseUrl` at it. Viewer tokens are bearer credentials, so no
cookies or `credentials: "include"` are needed.

## What a viewer can do

Viewer principals are **force-scoped and closed**: their tenant only, the listed link ids only
(when `links` is set), and only the actions in their `allow` list. Your `authorization` provider is
not consulted for them.

- Default actions: `analytics:read` and `link:read`.
- Grantable on top (still confined to the tenant and link set): `tenant:read`, `domain:read`,
  `link:create`, `link:update`, `link:delete`, `link:import`, `customer:read`, `audit:read`,
  `conversion:track`. Add `link:create` / `link:update` to let customers manage their own links
  through the same embed.
- Never grantable: tenant and domain management, the global audit log, minting further tokens.

Details: [Authorization](AUTHORIZATION.md).

## Revocation

Tokens are stateless: there is no list to delete from. A token stops working when it expires or
when you rotate `portal.secret` (which invalidates every outstanding token). Keep lifetimes short
(minutes to hours) and mint on demand.

## What the widget shows

> TODO(ui): fill in from the shipped widget once the UI lands: the views in widget chrome (totals,
> clicks over time, top links, countries, devices, referrers, recent clicks?), which controls are
> hidden when the sink reports `crossFilter: false` / `uniques: false` / `events: false`, how link
> management appears when the token grants `link:create` / `link:update`, and a screenshot
> (`docs/assets/ui-widget.png`).
