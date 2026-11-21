/**
 * A minimal host app for the React-embed e2e and screenshots (served by
 * scripts/demo-app.ts at /e2e/embed). Mounts the **built** embed
 * (`dist/react.js` + the scoped `dist/react.css`) — the artifact consumers
 * install — not the sources.
 *
 * Query params:
 * - `mode` — `widget` (default: `<LinkAnalytics>` with a freshly minted viewer
 *   token) or `dashboard` (`<LinksDashboard>`).
 * - `theme` — the `theme` prop (`auto | inherit | light | dark`, default `inherit`).
 * - `tenant`, `links`, `allow` — viewer-token scope for the widget.
 *
 * @module
 */

import React from "react";
import { createRoot } from "react-dom/client";
// @ts-expect-error — built artifact (no sibling .d.ts at this path); typed via src/react.tsx.
import { LinkAnalytics, LinksDashboard } from "../dist/react.js";
import type { EmbedTheme } from "../src/react.tsx";

const params = new URLSearchParams(location.search);
const theme = (params.get("theme") ?? "inherit") as EmbedTheme;
const mode = params.get("mode") ?? "widget";
const apiBaseUrl = `${location.origin}/links`;

async function main() {
  const root = createRoot(document.getElementById("host-root")!);
  if (mode === "dashboard") {
    root.render(
      <LinksDashboard
        apiBaseUrl={apiBaseUrl}
        routing="memory"
        theme={theme}
        initialTenant="acme"
      />,
    );
    return;
  }
  const scope = new URLSearchParams({ tenant: params.get("tenant") ?? "acme" });
  for (const key of ["links", "allow"]) {
    const v = params.get(key);
    if (v) scope.set(key, v);
  }
  const { token } = (await (await fetch(`/e2e/viewer-token?${scope}`)).json()) as { token: string };
  root.render(<LinkAnalytics apiBaseUrl={apiBaseUrl} token={token} theme={theme} />);
}

void main();
