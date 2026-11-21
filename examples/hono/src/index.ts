/**
 * Hono + @xtandard/links — the admin panel AND the redirect plane in one app,
 * on SQLite.
 *
 *   bun add hono @xtandard/links
 *   bun run src/index.ts
 *
 * Then:
 *   - GET  /links      → the admin panel (links, analytics, QR codes).
 *   - GET  /docs       → a short link → redirects (and records a click).
 *   - GET  /           → your own route: short links fall through to it.
 *   - POST /campaigns  → your own route creating a link with `panel.core`.
 */
import { Hono } from "hono";
import { linksPanel, linksRedirect } from "@xtandard/links/hono";
import { createSqliteStorage } from "@xtandard/links/storage/sqlite";
import { seedIfEmpty } from "./seed.ts";

const port = Number(process.env.PORT) || 3000;

// Links, domains, rollups and attribution all live in one SQLite file.
const storage = createSqliteStorage({ path: process.env.LINKS_DB ?? "./links.db" });

const panel = linksPanel({
  storage,
  basePath: "/links",
  title: "Acme Links",
  // Short links live on this host. In production: your branded domain ("go.acme.com").
  defaultDomain: "localhost",
});
await seedIfEmpty(panel.core);

const app = new Hono();

// 1. The panel first: Hono runs handlers in registration order.
app.route("/links", panel);

// 2. Short links. Anything that is not one (unknown slug, `/`, reserved paths)
//    continues to the routes below.
app.use(linksRedirect({ core: panel.core }));

// 3. Your app.
app.get("/", (c) =>
  c.html(`<h1>Acme</h1>
<p>Try a short link: <a href="/docs">/docs</a>, <a href="/gh">/gh</a> — or open <a href="/links">the panel</a>.</p>`),
);

app.post("/campaigns", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { url?: string; name?: string };
  const link = await panel.core.createLink({
    url: body.url ?? "https://example.com/spring-sale",
    tags: ["campaign"],
    utm: { source: "app", campaign: body.name ?? "spring" },
  });
  return c.json({ shortUrl: `http://localhost:${port}/${link.slug}`, link }, 201);
});

console.log(`Hono listening on http://localhost:${port} (panel at /links, try /docs)`);
export default { port, fetch: app.fetch };
