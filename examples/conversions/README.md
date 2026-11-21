# conversions × @xtandard/links

"Which link brought this signup — and this revenue?" One script, no server:

1. create a link with `trackConversions: true`;
2. click it — the redirect appends `?xl_id=clk_…` to the destination;
3. the destination site captures the click id (`captureClickId()` from
   `@xtandard/links/client`) and sends it with the signup → `core.trackLead`;
4. the customer pays → `core.trackSale` (a repeated `invoiceId` is ignored);
5. `core.queryAnalytics` shows clicks, leads and revenue per link.

## Run it

```bash
# from the repo root (build once first: bun run build)
bun run examples:conversions

# or in this directory
bun install
bun run start
```

Expected output (ids and dates vary):

```
1. link       https://go.acme.com/spring → https://acme.com/pricing
2. click      302 → https://acme.com/pricing?utm_source=newsletter&utm_campaign=spring&xl_id=clk_…
3. lead       customer usr_42 ← link lnk_…
4. sale       4900 USD (retry duplicate: true)
5. totals     {"clicks":3,"botClicks":0,"leads":1,"sales":1,"saleAmount":4900}
   /spring  clicks=2 leads=1 sales=1 revenue=4900
   /blog    clicks=1 leads=0 sales=0 revenue=0
```

The script uses `createTestLinks()` from `@xtandard/links/testing` so background
writes can be flushed deterministically. In an app, the same calls run on the
core you already mounted (`panel.core`), or over HTTP: `POST /links/api/track/lead`
and `/api/track/sale` (see the HTTP API docs).
