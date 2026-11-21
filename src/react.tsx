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

import React from "react";
import type { BaseLocationHook } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useBrowserLocation } from "wouter/use-browser-location";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./ui/App.tsx";
import { ToastProvider } from "./ui/components/Toast.tsx";
import { setApiBase, setApiToken, type FetchLike } from "./ui/api.ts";
import { setPortalContainerRef } from "./ui/lib/portal-container.ts";
import {
  detectHostTheme,
  getThemePref,
  resolveTheme,
  subscribeSystemTheme,
  subscribeThemePref,
  watchHostTheme,
  type ResolvedTheme,
} from "./ui/theme.ts";
import "./ui/styles.css";

/** Theme modes for the embedded components (see {@link LinksDashboardProps.theme}). */
export type EmbedTheme = "auto" | "inherit" | "light" | "dark";

/** Resolve the embed's theme for `mode`, re-rendering when its source changes. */
function useEmbedTheme(mode: EmbedTheme): ResolvedTheme {
  const read = React.useCallback((): ResolvedTheme => {
    if (mode === "light" || mode === "dark") return mode;
    if (mode === "inherit") return detectHostTheme();
    return resolveTheme(getThemePref());
  }, [mode]);

  const [resolved, setResolved] = React.useState<ResolvedTheme>(read);

  React.useEffect(() => {
    const update = () => setResolved(read());
    update();
    if (mode === "inherit") return watchHostTheme(update);
    if (mode === "auto") {
      const offPref = subscribeThemePref(update);
      const offSystem = subscribeSystemTheme(update);
      return () => {
        offPref();
        offSystem();
      };
    }
    return undefined;
  }, [mode, read]);

  return resolved;
}

/** Props for {@link LinksDashboard}. */
export interface LinksDashboardProps {
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
  routing?: "hash" | "browser" | "memory" | BaseLocationHook;
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

let fallbackClient: QueryClient | undefined;
function getClient(): QueryClient {
  fallbackClient ??= new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  });
  return fallbackClient;
}

/** The full links admin dashboard as an embeddable React component. */
export function LinksDashboard({
  apiBaseUrl = "",
  credentials,
  fetch: fetchImpl,
  queryClient,
  theme = "auto",
  className,
  routing = "hash",
  routerBase = "",
  logoUrl,
  initialTenant,
}: LinksDashboardProps): React.ReactElement {
  // Set the API base synchronously so child queries (run on mount) use it.
  setApiBase(apiBaseUrl, { credentials, fetch: fetchImpl });

  const resolvedTheme = useEmbedTheme(theme);

  const client = queryClient ?? getClient();

  // Point Base UI portals (Select/Combobox popups, Dialogs) at the scoped
  // wrapper so they render inside `.xtandard-links` — the embed stylesheet
  // is scoped, so anything portaled to document.body would be unstyled.
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  setPortalContainerRef(wrapperRef);

  // Resolve the routing strategy to a wouter location hook (+ base). The memory
  // location is created once so its in-memory history (and query string, which
  // carries the tenant and analytics filters) survives re-renders.
  const memory = React.useMemo(() => memoryLocation(), []);
  const { hook, searchHook, base } = React.useMemo(() => {
    if (typeof routing === "function")
      return { hook: routing, searchHook: undefined, base: routerBase };
    if (routing === "browser")
      return { hook: useBrowserLocation, searchHook: undefined, base: routerBase };
    if (routing === "memory") return { hook: memory.hook, searchHook: memory.searchHook, base: "" };
    return { hook: useHashLocation, searchHook: undefined, base: "" };
  }, [routing, routerBase, memory]);

  return (
    <QueryClientProvider client={client}>
      {/* Toasts render inside the wrapper so the scoped stylesheet + theme reach them. */}
      <div
        ref={wrapperRef}
        data-theme={resolvedTheme}
        className={className ? `xtandard-links ${className}` : "xtandard-links"}
      >
        <ToastProvider>
          <App
            locationHook={hook}
            searchHook={searchHook}
            base={base}
            logoUrl={logoUrl}
            initialTenant={initialTenant}
            showThemeToggle={theme === "auto"}
          />
        </ToastProvider>
      </div>
    </QueryClientProvider>
  );
}

/**
 * The per-tenant analytics widget (ADR 0009) as an embeddable React component:
 * the same shell as {@link LinksDashboard} with a viewer token attached as a
 * Bearer credential. The server force-scopes every request to the token's
 * tenant, links and actions; `/config` flips the shell into the reduced widget
 * chrome (analytics first, read-only links, create/edit only when granted).
 */
export function LinkAnalytics({
  token,
  routing = "memory",
  ...rest
}: LinkAnalyticsProps): React.ReactElement {
  // Attach the token synchronously so child queries (run on mount) send it; the
  // effect keeps it current when the host swaps tokens (e.g. re-mint on expiry).
  // The API client is module-level state, so this assumes one embed per page —
  // same trade-off setApiBase makes.
  setApiToken(token);
  const client = rest.queryClient ?? getClient();
  React.useEffect(() => {
    setApiToken(token);
    // A new token may carry a different scope: refetch everything.
    void client.invalidateQueries();
  }, [token, client]);

  return <LinksDashboard {...rest} routing={routing} queryClient={client} />;
}

export { setApiBase, setApiToken, type FetchLike } from "./ui/api.ts";
export {
  setThemePref,
  getThemePref,
  detectHostTheme,
  type ThemePref,
  type ResolvedTheme,
} from "./ui/theme.ts";
export default LinksDashboard;
