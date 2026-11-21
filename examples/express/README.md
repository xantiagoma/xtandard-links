# express × @xtandard/links

The admin panel and the redirect plane as Express middleware, in front of your
own JSON routes.

```ts
const panel = linksPanel({ storage, basePath: "/links", defaultDomain: "localhost" });
app.use("/links", panel); // BEFORE express.json()
app.use(linksRedirect({ core: panel.core })); // short links, else next()
app.use(express.json());
```

- The **panel** reads the raw request body, so mount it before body parsers (a body
  `express.json()` already parsed is re-serialized, but raw is cheaper).
- The **redirect middleware** only reads a POST body when it is a password form for
  one of its links, so your parsers downstream still see an untouched stream.

The seeded `/docs` link has `trackConversions` on: its destination carries
`?xl_id=clk_…`, which your site sends back with the signup — `POST /signup` turns
it into a lead with `core.trackLead`.

## Run it

```bash
# from the repo root (build once first: bun run build)
bun run examples:express

# or in this directory
bun install
bun run start
```

## Try it

```bash
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' localhost:3000/docs); echo "$LOC"
CLICK=$(echo "$LOC" | sed -E 's/.*xl_id=([^&]+).*/\1/')
sleep 2   # clicks are recorded in the background
curl -s -X POST localhost:3000/signup -H 'content-type: application/json' \
  -d "{\"email\":\"ada@example.com\",\"clickId\":\"$CLICK\"}"      # → attributed: true
curl -s 'localhost:3000/links/api/tenants/default/analytics?interval=none' | jq .totals
```

Data lives in `./.links` (file storage); delete it to start over.
