/**
 * Bun.serve + @xtandard/links — no framework: route the panel by path, send
 * everything else through the redirect handler, and fall back to your app.
 *
 *   bun add @xtandard/links
 *   bun run src/index.ts
 *
 * Then:
 *   - GET /links       → the admin panel.
 *   - GET /docs        → a short link → redirect.
 *   - GET /app         → a link with a targeting rule (iPhone vs. everyone else).
 *   - GET /            → your app (the redirect handler's fallback).
 */
import { linksPanel, linksRedirect } from "@xtandard/links/bun";
import { createSqliteStorage } from "@xtandard/links/storage/sqlite";

const port = Number(process.env.PORT) || 3000;

const panel = linksPanel({
  storage: createSqliteStorage({ path: process.env.LINKS_DB ?? "./links.db" }),
  basePath: "/links",
  title: "Acme Links",
  defaultDomain: "localhost",
});

if ((await panel.core.listLinks("default", { limit: 1 })).total === 0) {
  await panel.core.createLink({
    slug: "docs",
    url: "https://me.xantiagoma.com/xtandard-links/",
  });
  await panel.core.createLink({
    slug: "app",
    url: "https://example.com/download",
    rules: [
      {
        name: "Germany",
        when: [{ field: "country", op: "in", values: ["DE", "AT", "CH"] }],
        url: "https://example.de/download",
      },
    ],
    ios: "https://apps.apple.com/app/id123456789",
  });
}

/** Your app — whatever the redirect handler doesn't claim lands here. */
function app(request: Request): Response {
  const { pathname } = new URL(request.url);
  if (pathname === "/") {
    return new Response(
      `<h1>Acme</h1><p><a href="/docs">/docs</a> · <a href="/links">panel</a></p>`,
      {
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    );
  }
  return new Response("Not found (from your app)", { status: 404 });
}

const redirects = linksRedirect({ core: panel.core, fallback: app });

const server = Bun.serve({
  port,
  fetch: (request) => {
    const { pathname } = new URL(request.url);
    // The panel first; short links next; your app last.
    return pathname === "/links" || pathname.startsWith("/links/")
      ? panel.fetch(request)
      : redirects.fetch(request);
  },
});

// Graceful shutdown: flush pending clicks and counters.
process.on("SIGINT", async () => {
  await redirects.handler.close();
  server.stop();
  process.exit(0);
});

console.log(`Bun.serve listening on http://localhost:${server.port} (panel at /links, try /docs)`);
