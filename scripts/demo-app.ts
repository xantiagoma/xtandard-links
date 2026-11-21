/**
 * One in-memory app behind `bun run demo`, the Playwright e2e server and the
 * screenshot script: the admin panel at `/links`, the redirect handler for
 * everything else (short links resolve on their own hostnames via `Host` /
 * `X-Forwarded-Host`, or on `lnks.dev` when the host is unknown), seeded with
 * {@link seedDemo}, plus a few helper routes:
 *
 *   GET /healthcheck                         → 200 once seeded
 *   GET /e2e/viewer-token?tenant=&links=&allow=&expiresIn=
 *                                            → { token } a freshly minted viewer token
 *   GET /e2e/embed?mode=&theme=&host=        → a host page mounting the built React embed
 *                                              (mode: dashboard | widget; host: class | attr | none)
 *
 * The embed pages need `bun run build:react` (dist/react.js + react.css); the
 * panel needs `bun run build:ui` (dist/ui).
 *
 * @module
 */

import { createMemoryAnalytics } from "../src/analytics/memory.ts";
import { createLinksCore } from "../src/core.ts";
import { createViewerToken } from "../src/portal.ts";
import { createRedirectHandler } from "../src/redirect.ts";
import { createFetchHandler } from "../src/server/create-fetch-handler.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";
import type { LinksAction } from "../src/authorization/contract.ts";
import type { LinksDuration } from "../src/schema.ts";
import { seedDemo, type SeedDemoResult } from "./seed-demo.ts";

export const PANEL_BASE = "/links";
const VIEWER_SECRET = "demo-viewer-secret";

export interface DemoApp {
  fetch(request: Request): Promise<Response>;
  seeded: SeedDemoResult;
  close(): Promise<void>;
}

export interface DemoAppOptions {
  title?: string;
  /** Synthetic click count (default 5000). */
  clicks?: number;
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

// The host page mimics a themed app: its own text/background per theme, so a
// panel that leaks or inherits the host's colors shows up as low contrast.
function embedHostHtml(host: string | null): string {
  const htmlAttr = host === "attr" ? ' data-theme="dark"' : host === "class" ? ' class="dark"' : "";
  return `<!doctype html>
<html lang="en"${htmlAttr}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Acme Cloud — embed host</title>
    <link rel="stylesheet" href="/e2e/react.css" />
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; background: #f4f4f5; color: #111111; }
      html.dark body, html[data-theme="dark"] body { background: #0b0b0c; color: #f4f4f5; }
      .host-bar { display: flex; align-items: center; gap: 12px; padding: 14px 28px; background: #18181b; color: #fafafa; }
      .host-bar b { font-size: 15px; letter-spacing: -0.01em; }
      .host-bar nav { display: flex; gap: 18px; margin-left: 24px; font-size: 13px; color: #a1a1aa; }
      .host-bar nav span:nth-child(2) { color: #fafafa; }
      .host-main { padding: 24px 28px; }
      .host-heading { margin: 0 0 4px; font-size: 20px; }
      .host-sub { margin: 0 0 18px; font-size: 13px; color: #71717a; }
      .host-frame { border-radius: 14px; overflow: hidden; box-shadow: 0 1px 3px rgb(0 0 0 / .08), 0 8px 30px rgb(0 0 0 / .06); }
    </style>
  </head>
  <body>
    <div class="host-bar"><b>◆ Acme Cloud</b><nav><span>Projects</span><span>Marketing</span><span>Billing</span><span>Settings</span></nav></div>
    <div class="host-main">
      <h2 class="host-heading">Campaign links</h2>
      <p class="host-sub">Rendered by &lt;LinkAnalytics&gt; / &lt;LinksDashboard&gt; from @xtandard/links/react inside the host app.</p>
      <div id="host-root" class="host-frame"></div>
    </div>
    <script type="module" src="/e2e/embed.js"></script>
  </body>
</html>`;
}

let embedBundle: Promise<string> | undefined;
async function buildEmbedHost(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [new URL("../e2e/embed-host.tsx", import.meta.url).pathname],
    target: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!result.success) throw new AggregateError(result.logs, "embed host bundle failed");
  return result.outputs[0]!.text();
}

/** Build and seed the demo app. */
export async function createDemoApp(options: DemoAppOptions = {}): Promise<DemoApp> {
  let pinned: number | undefined;
  const core = createLinksCore({
    storage: createMemoryStorage(),
    analytics: createMemoryAnalytics(),
    defaultDomain: "lnks.dev",
    now: () => pinned ?? Date.now(),
  });
  const seeded = await seedDemo(core, {
    clicks: options.clicks ?? 5000,
    clock: (ms) => {
      pinned = ms;
    },
  });

  const panel = createFetchHandler({
    core,
    basePath: PANEL_BASE,
    title: options.title ?? "Acme Links",
    portal: { secret: VIEWER_SECRET },
  });
  const redirects = createRedirectHandler({ core });

  async function fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/healthcheck") return json({ ok: true, ...seeded });
    if (path === PANEL_BASE || path.startsWith(`${PANEL_BASE}/`)) return panel.fetch(request);
    if (path === "/" && !request.headers.get("x-forwarded-host")) {
      return Response.redirect(new URL(`${PANEL_BASE}/`, url), 302);
    }
    if (path === "/e2e/viewer-token") {
      const q = url.searchParams;
      const links = q.get("links")?.split(",").filter(Boolean);
      const allow = q.get("allow")?.split(",").filter(Boolean) as LinksAction[] | undefined;
      const token = await createViewerToken(VIEWER_SECRET, {
        tenant: q.get("tenant") ?? "acme",
        ...(links?.length ? { links } : {}),
        ...(allow?.length ? { allow } : {}),
        expiresIn: (q.get("expiresIn") ?? "1h") as LinksDuration,
      });
      return json({ token });
    }
    if (path === "/e2e/embed") {
      return new Response(embedHostHtml(url.searchParams.get("host")), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (path === "/e2e/embed.js") {
      embedBundle ??= buildEmbedHost();
      return new Response(await embedBundle, {
        headers: { "content-type": "text/javascript; charset=utf-8" },
      });
    }
    if (path === "/e2e/react.css") {
      return new Response(Bun.file(new URL("../dist/react.css", import.meta.url)), {
        headers: { "content-type": "text/css; charset=utf-8" },
      });
    }
    return redirects.fetch(request);
  }

  return {
    fetch,
    seeded,
    async close() {
      await redirects.close();
      await core.close();
    },
  };
}
