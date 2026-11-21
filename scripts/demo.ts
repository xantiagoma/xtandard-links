/**
 * One-command demo: the seeded in-memory app (scripts/demo-app.ts) on one Bun
 * server — the admin panel at `/links`, short links answered by the redirect
 * handler on the same port.
 *
 *   bun run build:ui && bun run demo     # → http://localhost:7790/links
 *   PORT=3000 bun run demo
 *
 * Short links resolve by hostname, so try them with a Host override:
 *
 *   curl -i -H "X-Forwarded-Host: go.acme.com" http://localhost:7790/spring
 *
 * The React embed demo (`/e2e/embed?mode=widget|dashboard`) also needs
 * `bun run build:react`. Nothing is persisted; Ctrl-C stops everything.
 *
 * @module
 */

import { createDemoApp, PANEL_BASE } from "./demo-app.ts";

const PORT = Number(process.env.PORT ?? 7790);
const started = Date.now();
const app = await createDemoApp({ title: "Acme Links" });
const server = Bun.serve({ port: PORT, fetch: (request) => app.fetch(request) });

const base = `http://localhost:${server.port}`;
console.log(`
  @xtandard/links demo — seeded in ${Date.now() - started} ms
  ${app.seeded.links} links · ${app.seeded.clicks} clicks · ${app.seeded.leads} leads · ${app.seeded.sales} sales

  Panel           ${base}${PANEL_BASE}/
  Viewer widget   ${base}/e2e/embed?mode=widget     (needs bun run build:react)
  Short link      curl -i -H "X-Forwarded-Host: go.acme.com" ${base}/spring
`);

const shutdown = async () => {
  server.stop();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
