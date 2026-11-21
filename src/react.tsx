/**
 * `@xtandard/links/react` — embed the links dashboard, or the per-tenant
 * analytics widget, as React components in your own app (ADR 0003). Most hosts
 * mount the bundled SPA through a framework adapter and never touch React; this
 * is for teams that want the panel inside an existing React shell.
 *
 * Two components share the same SPA internals:
 *
 * ```tsx
 * import { LinksDashboard, LinkAnalytics } from "@xtandard/links/react";
 * import "@xtandard/links/react/styles.css";
 *
 * // Full admin — point it at wherever the panel API is mounted:
 * <LinksDashboard apiBaseUrl="/links" />
 *
 * // Your customer's analytics — pass a viewer token minted server-side
 * // (`createViewerToken` or POST /api/tenants/:tenant/viewer-tokens):
 * <LinkAnalytics apiBaseUrl="/links" token={viewerToken} />
 * ```
 *
 * `react` and `react-dom` are peer dependencies in this mode. The components are
 * self-contained otherwise (TanStack Query and styles are bundled).
 *
 * @module react
 */

import type { QueryClient } from "@tanstack/react-query";
import { createEmbed, type EmbedBaseProps, type EmbedRouting } from "@xtandard/kit/ui/embed";
import type { FetchLike } from "@xtandard/kit/ui";
import { App } from "./ui/App.tsx";
import * as api from "./ui/api.ts";
import { themeStore } from "./ui/theme.ts";
import "./ui/styles.css";

/** Theme modes for the embedded components (see {@link LinksDashboardProps.theme}). */
export type EmbedTheme = "auto" | "inherit" | "light" | "dark";

/** Props for {@link LinksDashboard}. */
export interface LinksDashboardProps extends EmbedBaseProps {
  /**
   * Base URL where the panel API + `/config` are mounted (e.g. `"/links"` or
   * `"https://admin.example.com/links"`). Defaults to `""` (same origin, relative).
   */
  apiBaseUrl?: string;
  /**
   * `credentials` mode for API requests. Defaults to `"same-origin"`. For a
   * **cross-origin** embed (panel served from a different origin than this app)
   * with cookie-based auth, set `"include"` — and enable `cors` on the panel
   * server so it returns `Access-Control-Allow-Credentials`.
   */
  credentials?: RequestCredentials;
  /**
   * Custom `fetch` for API requests — inject a bearer token / extra headers, or
   * instrument calls. Defaults to the global `fetch`.
   */
  fetch?: FetchLike;
  /** Bring your own QueryClient; one is created if omitted. */
  queryClient?: QueryClient;
  /**
   * Theme handling. The embed never writes to the host document — it resolves a
   * theme and applies it to its own wrapper (`data-theme`), so surfaces, text,
   * borders and charts always come from one theme.
   * - `"auto"` (default) — the panel's own system/light/dark switcher (preference
   *   persisted in localStorage).
   * - `"inherit"` — follow the host page, live: a `dark`/`light` class or
   *   `data-theme` attribute on `<html>` (then `<body>`), falling back to the OS
   *   `prefers-color-scheme`. The switcher is hidden; the host owns the theme.
   * - `"light"` / `"dark"` — force one theme (switcher hidden). Useful when the
   *   host tracks its theme some other way: pass its resolved value.
   */
  theme?: EmbedTheme;
  /** Extra className on the dashboard root wrapper. */
  className?: string;
  /**
   * How the dashboard routes between views/records.
   * - `"hash"` (default) — routes in `location.hash`; never touches the host app's
   *   router or pathname. Safest when mounted inside another app.
   * - `"browser"` — real history paths (clean URLs). Requires the host to serve the
   *   panel's `index.html` as a catch-all under `routerBase`, else refresh 404s.
   * - `"memory"` — in-memory only; no URL coupling at all.
   * - a custom wouter location hook for full control.
   */
  routing?: EmbedRouting;
  /** Base path the panel is mounted at, used by `routing: "browser"` (e.g. `"/admin/links"`). */
  routerBase?: string;
  /** Navbar logo image URL (replaces the title wordmark). Overrides server `/config`. */
  logoUrl?: string;
  /**
   * Pre-select a tenant on first render, overriding the default (the first
   * tenant) — e.g. an admin panel embedding one dashboard per customer. The URL
   * still wins when it names one (`?tenant=`), so deep links and the in-app
   * switcher behave normally afterwards.
   */
  initialTenant?: string;
}

/** Props for {@link LinkAnalytics}. */
export interface LinkAnalyticsProps extends Omit<LinksDashboardProps, "initialTenant"> {
  /**
   * Analytics viewer token (`lvt_…`) minted server-side (`createViewerToken()`
   * or `POST /api/tenants/:tenant/viewer-tokens`). Sent as an
   * `Authorization: Bearer` credential on every request; `/config` then reports
   * `viewer: true` and the shell renders the reduced widget chrome, pinned to
   * the token's tenant (and links, when the token lists them).
   */
  token: string;
}

/**
 * The shared embed plumbing (`@xtandard/kit/ui/embed`): one theme per embed on
 * the `.xtandard-links` wrapper, toasts and Base UI portals inside it, the
 * memory router keeping its query string (tenant and analytics filters), and
 * the viewer token attached synchronously (queries refetch when it changes, and
 * it is cleared on unmount).
 */
const embed = createEmbed<{ initialTenant?: string }>({
  App,
  scopeClass: "xtandard-links",
  api,
  themeKey: themeStore,
  tokenRouting: "memory", // the widget routes in memory, as it always has
  displayNames: { dashboard: "LinksDashboard", token: "LinkAnalytics" },
});

/** The full links admin dashboard as an embeddable React component. */
export const LinksDashboard: React.FC<LinksDashboardProps> = embed.Dashboard;

/**
 * The per-tenant analytics widget (ADR 0009) as an embeddable React component:
 * the same shell as {@link LinksDashboard} with a viewer token attached as a
 * Bearer credential. The server force-scopes every request to the token's
 * tenant, links and actions; the shell renders the reduced widget chrome
 * (analytics first, read-only links, create/edit only when granted).
 */
export const LinkAnalytics: React.FC<LinkAnalyticsProps> = embed.TokenEmbed;

export { setApiBase, setApiToken } from "./ui/api.ts";
export type { FetchLike };
export {
  setThemePref,
  getThemePref,
  detectHostTheme,
  type ThemePref,
  type ResolvedTheme,
} from "./ui/theme.ts";
export default LinksDashboard;
