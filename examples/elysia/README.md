# elysia × @xtandard/links

The **typed** admin plugin plus the redirect plane in Elysia 1.x, with an
**Eden treaty** client calling the admin API end to end — no codegen.

```ts
const admin = linksElysia({ prefix: "/links", storage, defaultDomain: "localhost" });
const app = new Elysia()
  .use(admin)
  .use(linksRedirect({ core: admin.decorator.linksCore })) // onRequest, before routing
  .listen(3000);
export type App = typeof app;

// elsewhere:
const client = treaty<App>("localhost:3000");
await client.links.api.tenants({ tenant: "default" }).links.post({ url: "https://elysiajs.com" });
```

`linksRedirect` runs in `onRequest`, so it sees every request first. Requests that
are not short links (unknown slugs, `/`, reserved first segments) continue to your
routes; the example reserves `links` so panel requests skip the resolver entirely.

Prefer an opaque mount? `new Elysia().mount("/links", linksPanel({ storage, basePath: "/links" }))`
works too — Eden just can't see its routes. On Elysia 2 import from
`@xtandard/links/elysia2` (and use `@elysia/eden`).

## Run it

```bash
# from the repo root (build once first: bun run build)
bun run examples:elysia

# or in this directory
bun install
bun run start            # server on :3000 (PORT overrides)
bun run demo             # Eden client: create → click → list → delete
```

## Try it

```bash
curl -i localhost:3000/docs                                    # 302 to the docs
curl -s localhost:3000/links/api/tenants/default/links | jq '.links[].slug'
```

Data lives in `./.links` (file storage); delete it to start over.
