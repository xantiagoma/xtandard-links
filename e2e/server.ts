/**
 * The Playwright e2e server, booted by playwright.config.ts's webServer: the
 * seeded in-memory demo app (panel at `/links`, redirect handler for short
 * links, viewer-token + React-embed helper routes — see scripts/demo-app.ts).
 *
 *   PORT=3311 bun e2e/server.ts
 *
 * @module
 */

import { createDemoApp } from "../scripts/demo-app.ts";

const PORT = Number(process.env.PORT ?? 3311);
const app = await createDemoApp({ title: "@xtandard/links e2e" });

Bun.serve({ port: PORT, fetch: (request) => app.fetch(request) });

console.log(
  `e2e server on http://localhost:${PORT}/links (${app.seeded.links} links, ${app.seeded.clicks} clicks)`,
);
