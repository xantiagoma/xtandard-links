# hono × @xtandard/links

The admin panel **and** the redirect plane mounted in one Hono app, with links,
analytics rollups and attribution stored in a single SQLite file.

```ts
const panel = linksPanel({ storage, basePath: "/links", defaultDomain: "localhost" });
app.route("/links", panel); // first: Hono runs handlers in registration order
app.use(linksRedirect({ core: panel.core })); // short links, else next()
```

`linksRedirect` answers short links and calls `next()` for everything else —
unknown slugs, `/`, reserved paths — so it can sit in front of your own routes.
Both handlers share **one core** (`panel.core`), so a link created in the panel
redirects immediately.

## Run it

```bash
# from the repo root (build once first: bun run build)
bun run examples:hono

# or in this directory
bun install
bun run start
```

## Try it

```bash
curl -i localhost:3000/docs              # 302 → https://me.xantiagoma.com/xtandard-links/?utm_source=example&utm_medium=shortlink
curl -s localhost:3000/                  # your own route (falls through)
curl -s -X POST localhost:3000/campaigns -H 'content-type: application/json' \
  -d '{"url":"https://example.com/sale","name":"black-friday"}'
curl -s localhost:3000/links/api/tenants/default/links | jq '.links[].slug'
curl -s 'localhost:3000/links/api/tenants/default/analytics?groupBy=browser' | jq .totals
```

`curl`'s user agent is recognised as a bot, so its clicks land in `botClicks`;
pass a browser one (`-A 'Mozilla/5.0 (Macintosh; …) Chrome/131.0.0.0 Safari/537.36'`)
to count a click.

Open <http://localhost:3000/links> for the dashboard (the UI needs `bun run build`
at the repo root; the JSON API works without it).

`LINKS_DB` overrides the SQLite path (default `./links.db`). SQLite storage needs
Bun (`bun:sqlite`); on Node swap in `storage/file`, `storage/postgres`, … — nothing
else changes.
