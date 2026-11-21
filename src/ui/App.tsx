import React from "react";
import {
  Route,
  Router,
  Switch,
  useLocation,
  useSearchParams,
  type BaseLocationHook,
  type BaseSearchHook,
} from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Lock } from "lucide-react";
import type { LinksConfig } from "./types.ts";
import { errorMessage, LinksApiError } from "./types.ts";
import { getConfig, listTenants, upsertTenant } from "./api.ts";
import { useToast } from "./components/Toast.tsx";
import { ThemeToggle } from "./components/ThemeToggle.tsx";
import { BrandMark } from "./components/BrandMark.tsx";
import { CreatableCombobox } from "./components/primitives.tsx";
import { EmptyCard, LoadingRow, Page } from "./components/bits.tsx";
import { LinksView } from "./views/LinksView.tsx";
import { LinkDetailView } from "./views/LinkDetailView.tsx";
import { AnalyticsView } from "./views/AnalyticsView.tsx";
import { DomainsView } from "./views/DomainsView.tsx";
import { ImportView } from "./views/ImportView.tsx";
import { CustomersView } from "./views/CustomersView.tsx";
import { AuditView } from "./views/AuditView.tsx";
import { cn } from "./lib/utils.ts";
import { canLeave } from "./lib/nav-guard.ts";
import { canPerform, ShellContext, type Shell } from "./lib/shell.tsx";

declare global {
  interface Window {
    __LINKS_CONFIG__?: Partial<LinksConfig>;
  }
}

interface NavTab {
  path: string;
  label: string;
  match: (loc: string) => boolean;
}

// Admin chrome: Links is the index. The viewer (widget) chrome lands on the
// tenant's analytics and keeps only what a viewer token can read.
const ADMIN_TABS: NavTab[] = [
  { path: "/", label: "Links", match: (l) => l === "/" || l.startsWith("/links") },
  { path: "/analytics", label: "Analytics", match: (l) => l.startsWith("/analytics") },
  { path: "/domains", label: "Domains", match: (l) => l.startsWith("/domains") },
  { path: "/import", label: "Import", match: (l) => l.startsWith("/import") },
  { path: "/customers", label: "Conversions", match: (l) => l.startsWith("/customers") },
  { path: "/audit", label: "Audit", match: (l) => l.startsWith("/audit") },
];

const VIEWER_TABS: NavTab[] = [
  { path: "/", label: "Analytics", match: (l) => l === "/" || l.startsWith("/analytics") },
  { path: "/links", label: "Links", match: (l) => l.startsWith("/links") },
];

const DEFAULT_CAPS: LinksConfig["capabilities"] = {
  crossFilter: false,
  uniques: false,
  events: false,
  intervals: ["day"],
};

/**
 * The dashboard, wrapped in a wouter {@link Router}. `locationHook` + `base`
 * make routing pluggable: the bundled SPA uses browser history, the embeds
 * default to hash routing (or memory) so they never touch the host's router.
 */
export function App({
  locationHook,
  searchHook,
  base = "",
  logoUrl,
  initialTenant,
  showThemeToggle = true,
}: {
  locationHook?: BaseLocationHook;
  searchHook?: BaseSearchHook;
  base?: string;
  /** Override the navbar logo image (otherwise taken from server `/config`). */
  logoUrl?: string;
  /** Pre-select a tenant when the URL doesn't name one (embed hosts). */
  initialTenant?: string;
  /** Show the system/light/dark switcher. Off when an embedding host owns the theme. */
  showThemeToggle?: boolean;
}): React.ReactElement {
  return (
    <Router
      hook={locationHook ?? useHashLocation}
      {...(searchHook ? { searchHook } : {})}
      base={base}
    >
      <AppShell logoUrl={logoUrl} initialTenant={initialTenant} showThemeToggle={showThemeToggle} />
    </Router>
  );
}

function AppShell({
  logoUrl,
  initialTenant,
  showThemeToggle,
}: {
  logoUrl?: string;
  initialTenant?: string;
  showThemeToggle: boolean;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [location, navigate] = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const configQuery = useQuery({ queryKey: ["config"], queryFn: getConfig, staleTime: 60_000 });
  const bootstrap = typeof window !== "undefined" ? (window.__LINKS_CONFIG__ ?? {}) : {};
  const config: LinksConfig = {
    title: "@xtandard/links",
    basePath: "",
    readonly: false,
    viewer: false,
    capabilities: DEFAULT_CAPS,
    version: "",
    ...bootstrap,
    ...configQuery.data,
  };
  const viewer = config.viewer;
  const readonly = config.readonly;

  const tenantsQuery = useQuery({
    queryKey: ["tenants"],
    queryFn: listTenants,
    staleTime: 60_000,
    enabled: configQuery.isSuccess && !viewer,
  });
  const tenants = tenantsQuery.data ?? [];

  // Tenant precedence: a viewer token pins it; else the URL (?tenant=, written
  // by the switcher so links are shareable), the embed's initial prop, then
  // the first tenant (or "default" on a fresh install).
  const tenant = viewer
    ? (config.tenant ?? "")
    : searchParams.get("tenant") ||
      initialTenant ||
      tenants[0]?.key ||
      (tenantsQuery.isSuccess ? "default" : "");

  const go = React.useCallback(
    (path: string) => {
      if (!canLeave()) return;
      const t = searchParams.get("tenant");
      const [pathname = "/", query = ""] = path.split("?");
      const next = new URLSearchParams(query);
      if (t && !viewer && !next.has("tenant")) next.set("tenant", t);
      const s = next.toString();
      navigate(s ? `${pathname}?${s}` : pathname);
    },
    [navigate, searchParams, viewer],
  );

  const setTenant = (key: string) => {
    if (!canLeave()) return;
    // A link detail belongs to the old tenant: land on the list instead.
    if (location.startsWith("/links/")) navigate(`/?tenant=${encodeURIComponent(key)}`);
    else setSearchParams(() => new URLSearchParams({ tenant: key }));
  };

  const createTenant = useMutation({
    mutationFn: (key: string) => upsertTenant({ key }),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: ["tenants"] });
      setTenant(t.key);
      toast.add("success", `Tenant "${t.key}" created`);
    },
    onError: (err) => toast.add("error", errorMessage(err, "Failed to create tenant")),
  });

  const shell: Shell = React.useMemo(
    () => ({
      config,
      tenant,
      viewer,
      can: (action: string) => canPerform(config, action),
      go,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configQuery.data, tenant, viewer, go],
  );

  const brandTitle = config.title || "@xtandard/links";
  const brandLogoUrl = logoUrl ?? config.logoUrl;
  const tabs = viewer
    ? VIEWER_TABS.filter((t) => t.path !== "/links" || canPerform(config, "link:read"))
    : ADMIN_TABS;

  const unauthorized =
    configQuery.error instanceof LinksApiError && configQuery.error.status === 401;

  return (
    <ShellContext.Provider value={shell}>
      <div className="flex h-full min-h-screen flex-col bg-background text-foreground">
        <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
            <div className="flex shrink-0 items-center gap-2">
              {brandLogoUrl ? (
                <img
                  src={brandLogoUrl}
                  alt={brandTitle}
                  className="h-7 max-w-[320px] object-contain"
                />
              ) : (
                <>
                  <BrandMark className="h-5 w-auto" />
                  <span className="text-sm font-semibold tracking-tight">{brandTitle}</span>
                </>
              )}
            </div>

            {configQuery.isSuccess && (
              <>
                <span className="select-none text-border">/</span>
                {viewer ? (
                  <span className="font-mono text-[13px] text-muted-foreground">{tenant}</span>
                ) : (
                  <CreatableCombobox
                    value={tenant}
                    options={tenants.map((t) => t.key)}
                    onSelect={setTenant}
                    onCreate={(key) => createTenant.mutate(key)}
                    disabled={readonly}
                    aria-label="Tenant"
                    placeholder="Tenant"
                    createLabel={(q) => `Create tenant "${q}"`}
                    className="w-44"
                  />
                )}
              </>
            )}

            <div className="ml-auto flex items-center gap-2">
              {readonly && (
                <span className="flex items-center gap-1 rounded-md border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                  <Lock className="size-3" />
                  Read-only
                </span>
              )}
              {viewer && (
                <span
                  className="flex items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent"
                  title={
                    config.expiresAt
                      ? `Access expires ${new Date(config.expiresAt).toLocaleString()}`
                      : undefined
                  }
                >
                  <Eye className="size-3" />
                  Viewer
                </span>
              )}
              {showThemeToggle && <ThemeToggle />}
            </div>
          </div>

          {configQuery.isSuccess && (
            <nav
              className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-2 sm:px-4"
              aria-label="Main navigation"
            >
              {tabs.map(({ path, label, match }) => (
                <button
                  key={path}
                  type="button"
                  onClick={() => go(path)}
                  aria-current={match(location) ? "page" : undefined}
                  className={cn(
                    "whitespace-nowrap px-3 py-2.5 text-[13px] font-medium transition-colors outline-none focus-visible:text-foreground",
                    match(location)
                      ? "relative text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-accent"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </nav>
          )}
        </header>

        <main className="flex-1">
          {configQuery.isLoading ? (
            <LoadingRow label="Loading…" />
          ) : configQuery.isError ? (
            <Page>
              <EmptyCard icon={<Lock className="size-4" />}>
                {unauthorized
                  ? `Not authorized: ${errorMessage(configQuery.error, "sign in to use this panel.")}`
                  : errorMessage(configQuery.error, "Could not reach the links panel.")}
              </EmptyCard>
            </Page>
          ) : viewer ? (
            <Switch>
              <Route path="/links/:id">{(p) => <LinkDetailView id={p.id} />}</Route>
              <Route path="/links">
                <LinksView />
              </Route>
              <Route>
                <AnalyticsView />
              </Route>
            </Switch>
          ) : (
            <Switch>
              <Route path="/links/:id">{(p) => <LinkDetailView id={p.id} />}</Route>
              <Route path="/analytics">
                <AnalyticsView />
              </Route>
              <Route path="/domains">
                <DomainsView />
              </Route>
              <Route path="/import">
                <ImportView />
              </Route>
              <Route path="/customers">
                <CustomersView />
              </Route>
              <Route path="/audit">
                <AuditView />
              </Route>
              <Route>
                <LinksView />
              </Route>
            </Switch>
          )}
        </main>
      </div>
    </ShellContext.Provider>
  );
}
