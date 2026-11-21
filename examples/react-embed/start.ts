/**
 * One-command runner for the react-embed example: boots a throwaway in-memory
 * links panel on :3702 (seeded with links and a few dozen clicks), exposes a
 * demo `/viewer-token` mint route, then starts the Vite host app.
 *
 *   bun run start          # → http://localhost:5191 (vite) + panel on :3702
 *   # or from the repo root: bun run examples:react-embed
 *
 * Ctrl-C stops both. Nothing is persisted.
 */
import { createFetchHandler, createRedirectHandler, createViewerToken } from "@xtandard/links";
import { createMemoryStorage } from "@xtandard/links/storage/memory";
import { clickRequest, USER_AGENTS } from "@xtandard/links/testing";

const PANEL_PORT = 3702; // must match PANEL in vite.config.ts
const VITE_PORT = process.env.PORT ?? "5191";
const TENANT = "acme";

// The viewer-token secret NEVER reaches a browser — it only mints and verifies
// tokens server-side. Fixed here so the demo is reproducible.
const VIEWER_SECRET = "react-embed-demo-secret-change-me";

const panel = createFetchHandler({
  storage: createMemoryStorage(),
  basePath: "/links",
  title: "Acme Links",
  defaultDomain: "go.acme.com",
  // A valid `lvt_…` bearer becomes a viewer confined to its token's tenant (and links).
  portal: { secret: VIEWER_SECRET },
});

// Seed: a few links for the customer tenant, then clicks through the real redirect plane.
const core = panel.core;
const links = await Promise.all([
  core.createLink({
    tenant: TENANT,
    slug: "pricing",
    url: "https://acme.com/pricing",
    tags: ["launch"],
  }),
  core.createLink({
    tenant: TENANT,
    slug: "blog",
    url: "https://acme.com/blog/launch",
    tags: ["launch"],
  }),
  core.createLink({ tenant: TENANT, slug: "app", url: "https://acme.com/download" }),
]);
const redirects = createRedirectHandler({ core, ingestor: { flushIntervalMs: 0 } });
const agents = [
  USER_AGENTS.iphone,
  USER_AGENTS.android,
  USER_AGENTS.macChrome,
  USER_AGENTS.windowsEdge,
  USER_AGENTS.linuxFirefox,
];
const countries = ["US", "US", "DE", "GB", "BR", "JP", "FR"];
const referrers = [
  "https://twitter.com/",
  "https://news.ycombinator.com/",
  "https://www.google.com/",
  undefined,
];
for (let i = 0; i < 60; i++) {
  const link = links[i % links.length]!;
  const referrer = referrers[i % referrers.length];
  await redirects.fetch(
    clickRequest(`https://go.acme.com/${link.slug}`, {
      userAgent: agents[i % agents.length],
      country: countries[i % countries.length],
      ip: `198.51.100.${i}`,
      ...(referrer ? { referrer } : {}),
    }),
  );
}
await redirects.close(); // flush the seeded clicks

const server = Bun.serve({
  port: PANEL_PORT,
  fetch: async (request) => {
    const url = new URL(request.url);
    // Simulates the HOST APP's backend: a session-guarded route that mints a
    // viewer token for the signed-in customer's tenant. Vite proxies it here.
    if (url.pathname === "/viewer-token" && request.method === "POST") {
      const token = await createViewerToken(VIEWER_SECRET, { tenant: TENANT, expiresIn: "1h" });
      return Response.json({ token, tenant: TENANT, expiresIn: "1h" });
    }
    return panel.fetch(request);
  },
});

console.log(
  `\n▶ react-embed host app → http://localhost:${VITE_PORT} (panel on :${PANEL_PORT}/links)\n`,
);
const vite = Bun.spawn(["bunx", "vite", "--port", VITE_PORT], {
  stdout: "inherit",
  stderr: "inherit",
});

const shutdown = () => {
  vite.kill();
  server.stop(true);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await vite.exited;
shutdown();
