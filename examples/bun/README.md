# bun × @xtandard/links

`Bun.serve` with no framework: both handlers are web-standard, so routing is a
path check.

```ts
const panel = linksPanel({ storage, basePath: "/links", defaultDomain: "localhost" });
const redirects = linksRedirect({ core: panel.core, fallback: app });

Bun.serve({
  fetch: (req) =>
    new URL(req.url).pathname.startsWith("/links") ? panel.fetch(req) : redirects.fetch(req),
});
```

`redirects.fetch` answers short links and calls `fallback` for anything that is
not one (unknown slugs, `/`, reserved paths). Without a `fallback` it renders the
built-in 404 page — what you want on a dedicated short domain.
`redirects.handle(req)` is the raw `Response | null` if you prefer to branch
yourself.

## Run it

```bash
# from the repo root (build once first: bun run build)
bun run examples:bun

# or in this directory
bun install
bun run start
```

## Try it

```bash
curl -i localhost:3000/docs                                   # 302 → the docs
curl -sI localhost:3000/app -H 'cf-ipcountry: DE' | grep -i location   # → example.de (rule)
curl -sI localhost:3000/app -A 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)' | grep -i location  # → App Store
curl -s localhost:3000/nope                                   # your app's 404 (fallback)
```

`Ctrl-C` flushes pending clicks before exiting. `LINKS_DB` overrides the SQLite
path (default `./links.db`).
