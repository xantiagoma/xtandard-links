import React from "react";
import { LinkAnalytics, LinksDashboard } from "@xtandard/links/react";
import "@xtandard/links/react/styles.css";

/** The panel API, proxied by Vite (see vite.config.ts) — same-origin to this app. */
const API = "/links";

type Tab = "widget" | "dashboard";

/**
 * A host SaaS app embedding the two links components:
 *
 * - **Analytics** (customer-facing): `<LinkAnalytics>` with a viewer token the
 *   frontend fetched from ITS OWN backend (`/viewer-token` — in real life a
 *   session-guarded route calling `createViewerToken`). The token confines every
 *   request to one tenant (`acme`) and read-only analytics.
 * - **Admin** (operator-facing): `<LinksDashboard>`, the full links admin, using the
 *   panel's own auth (none in this demo).
 */
export function App(): React.ReactElement {
  const [tab, setTab] = React.useState<Tab>("widget");
  const [token, setToken] = React.useState<string>();
  const [error, setError] = React.useState<string>();

  React.useEffect(() => {
    fetch("/viewer-token", { method: "POST" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Token mint failed: HTTP ${res.status}`);
        setToken(((await res.json()) as { token: string }).token);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    background: "none",
    border: 0,
    color: "#fff",
    font: "600 14px system-ui",
    opacity: active ? 1 : 0.55,
    cursor: "pointer",
    padding: 0,
  });

  return (
    <div style={{ minHeight: "100vh" }}>
      <nav
        style={{
          background: "#111827",
          color: "#fff",
          padding: "10px 20px",
          font: "600 14px system-ui",
          display: "flex",
          gap: 16,
          alignItems: "center",
        }}
      >
        <span style={{ opacity: 0.6 }}>Acme SaaS</span>
        <span style={{ opacity: 0.3 }}>/</span>
        <button type="button" style={tabStyle(tab === "widget")} onClick={() => setTab("widget")}>
          Your link analytics
        </button>
        <button
          type="button"
          style={tabStyle(tab === "dashboard")}
          onClick={() => setTab("dashboard")}
        >
          Admin
        </button>
      </nav>
      <main style={{ padding: 20 }}>
        {tab === "dashboard" ? (
          <LinksDashboard apiBaseUrl={API} />
        ) : error ? (
          <p style={{ font: "14px system-ui" }}>
            Could not mint a viewer token ({error}) — is <code>start.ts</code> running?
          </p>
        ) : token ? (
          <LinkAnalytics apiBaseUrl={API} token={token} />
        ) : (
          <p style={{ font: "14px system-ui" }}>Minting a viewer token…</p>
        )}
      </main>
    </div>
  );
}
