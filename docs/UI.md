# Admin UI & React embeds

A prebuilt React SPA ships in the package (`dist/ui`) and is served by the panel handler under its
`basePath`: every framework adapter gives you the dashboard with one mount line, no build step on
your side (ADR [0003](ADR/0003-bundled-spa-ui.md)). The same bundle renders two chromes: the full
**admin dashboard**, and the reduced **analytics widget** for viewer tokens ([Widget](WIDGET.md)).
`@xtandard/links/react` exposes both as React components for hosts that render inside their own
React tree.

> TODO(ui): this page is a skeleton until the UI lands. Fill in the sections marked TODO from the
> shipped SPA, and add the screenshots (`docs/assets/ui-*.png`).

## The bundled dashboard

```ts
const panel = linksPanel({
  storage,
  basePath: "/links",
  title: "Acme links", // navbar wordmark and page title
  logoUrl: "/logo.svg", // replaces the wordmark (default: the xtandard-links symbol)
  readonly: false, // true hides and blocks every mutation
});
```

Open `{basePath}/`. The page receives its static configuration as `window.__LINKS_CONFIG__` plus a
`<base href>`, so it works under any prefix; everything else comes from `GET {basePath}/config`
(the signed-in principal, viewer mode, the analytics sink's `capabilities`) and the JSON API
([HTTP API](HTTP_API.md)). Auth is whatever the panel's `auth` provider does: Basic auth prompts in
the browser, delegated auth uses your session cookie ([Auth](AUTH.md)).

> TODO(ui): the views (links list with search / tags / archived filter, link editor incl. the rules
> editor, UTM, expiry, password, preview, deep-link fields; QR code dialog; bulk import with dry
> run; domains; analytics with timeseries and breakdowns; customers; audit log), keyboard
> shortcuts, theme switcher, and how controls adapt to `capabilities` (`crossFilter`, `uniques`,
> `events`) and to authorization (actions the principal lacks are hidden).

## React embeds

```tsx
import { LinksDashboard, LinkAnalytics } from "@xtandard/links/react";
import "@xtandard/links/react/styles.css";

// The full admin, inside your own React app:
<LinksDashboard apiBaseUrl="/links" theme="inherit" />;

// A customer's analytics, with a viewer token minted server-side:
<LinkAnalytics apiBaseUrl="/links" token={viewerToken} />;
```

`react` and `react-dom` (18 or 19) are optional peers needed only for this subpath; TanStack Query
and the styles are bundled. Styles are scoped under `.xtandard-links`, so they do not leak into
your page, and the embed never writes to your document (it applies its theme to its own wrapper).

### `<LinksDashboard>` props

| Prop            | Default         | Notes                                                                                                                                                                    |
| --------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apiBaseUrl`    | `""`            | where the panel is mounted (`"/links"`, or `"https://admin.example.com/links"`)                                                                                          |
| `credentials`   | `"same-origin"` | `"include"` for a cross-origin panel with cookie auth (enable `cors` on the panel)                                                                                       |
| `fetch`         | global `fetch`  | inject a bearer token or headers, or instrument calls                                                                                                                    |
| `queryClient`   | created         | bring your own TanStack `QueryClient`                                                                                                                                    |
| `theme`         | `"auto"`        | `"auto"` (own switcher, remembered), `"inherit"` (follow the host's `dark`/`light` class or `data-theme`), `"light"`, `"dark"`                                           |
| `routing`       | `"hash"`        | `"hash"` (never touches your router), `"browser"` (clean paths; serve the panel's `index.html` as a catch-all under `routerBase`), `"memory"`, or a wouter location hook |
| `routerBase`    | —               | with `routing: "browser"`, e.g. `"/admin/links"`                                                                                                                         |
| `logoUrl`       | from `/config`  | navbar logo                                                                                                                                                              |
| `initialTenant` | first tenant    | pre-select a tenant (a `?tenant=` in the URL still wins)                                                                                                                 |
| `className`     | —               | on the root wrapper                                                                                                                                                      |

`<LinkAnalytics>` takes the same props except `initialTenant`, plus the required `token`
([Widget](WIDGET.md)).

### Cross-origin embeds

When the panel runs on another origin than the page embedding it, enable CORS on the panel and, for
cookie auth, send credentials:

```ts
linksPanel({
  storage,
  basePath: "/links",
  cors: { origin: "https://app.acme.com", credentials: true },
});
```

```tsx
<LinksDashboard apiBaseUrl="https://admin.acme.com/links" credentials="include" />
```

Viewer tokens are bearer credentials and need no cookies. See [Adapters](ADAPTERS.md) for the
`cors` options.

`cors` also takes `methods`, `headers` and `maxAge`; `origin` may be a list or a predicate.

## Branding

The navbar shows the xtandard-links symbol next to `title` unless `logoUrl` is set; the favicon set
lives in the bundle ([Brand](BRAND.md)). The UI keeps the xtandard family's neutral palette with a
lime accent.

> TODO(ui): theming hooks (CSS variables a host may override), if the UI exposes any.

## Development

```sh
bun run dev:ui     # Vite dev server for src/ui
bun run build:ui   # → dist/ui (served by the panel)
bun run build:react # → dist/react.js + scoped dist/react.css
bun run test:e2e   # Playwright against the built UI
```

> TODO(ui): how `dev:ui` proxies the API (which backend it expects), and the demo seed
> (`bun run demo`, `bun run seed:demo`).
