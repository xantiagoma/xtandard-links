/**
 * Conversion attribution end to end, in one script (no server):
 *
 *   create a link with trackConversions
 *     → a visitor clicks it (the redirect appends ?xl_id=clk_…)
 *     → the destination site captures the click id and the visitor signs up (trackLead)
 *     → the customer pays, twice with the same invoice (trackSale, idempotent)
 *     → analytics show clicks, leads and revenue side by side.
 *
 *   bun run src/index.ts
 *
 * Uses `@xtandard/links/testing` for an in-memory core whose background writes
 * can be flushed deterministically; in your app the same calls run on
 * `panel.core` and the redirect handler you already mounted.
 */
import { clickRequest, createTestLinks, USER_AGENTS } from "@xtandard/links/testing";

const { core, redirects, flush } = createTestLinks({ defaultDomain: "go.acme.com" });

// 1. A campaign link that tracks conversions.
const link = await core.createLink({
  slug: "spring",
  url: "https://acme.com/pricing",
  trackConversions: true,
  utm: { source: "newsletter", campaign: "spring" },
});
console.log(`1. link       https://${link.domain}/${link.slug} → ${link.url}`);

// A second link with no conversions, for comparison.
const other = await core.createLink({ slug: "blog", url: "https://acme.com/blog" });

// 2. Visitors click: one from Germany on an iPhone, one from the US on a Mac.
const res = await redirects.fetch(
  clickRequest("https://go.acme.com/spring", { userAgent: USER_AGENTS.iphone, country: "DE" }),
);
await redirects.fetch(clickRequest("https://go.acme.com/spring", { country: "US" }));
await redirects.fetch(clickRequest("https://go.acme.com/blog", { country: "US" }));
const location = res.headers.get("location")!;
console.log(`2. click      ${res.status} → ${location}`);

// 3. On acme.com, `captureClickId()` (from @xtandard/links/client) stores the
//    xl_id parameter in a cookie; the signup request sends it back.
const clickId = new URL(location).searchParams.get("xl_id")!;
await flush(); // the click (and its attribution ref) is recorded in the background
const lead = await core.trackLead({
  clickId,
  customerId: "usr_42",
  customerEmail: "ada@example.com",
  name: "Sign up",
});
console.log(
  `3. lead       ${lead ? `customer ${lead.customer.id} ← link ${lead.event.linkId}` : "not attributed"}`,
);

// 4. The customer pays. A retried webhook with the same invoice id is ignored.
const sale = await core.trackSale({
  customerId: "usr_42",
  amount: 4900,
  currency: "USD",
  invoiceId: "inv_1",
});
const retry = await core.trackSale({
  customerId: "usr_42",
  amount: 4900,
  currency: "USD",
  invoiceId: "inv_1",
});
console.log(
  `4. sale       ${sale?.event.amount} ${sale?.event.currency} (retry duplicate: ${retry?.duplicate === true})`,
);

// 5. Analytics: clicks, leads and revenue together, per link.
await flush();
const now = Date.now();
const stats = await core.queryAnalytics({
  tenant: "default",
  from: new Date(now - 86_400_000).toISOString(),
  to: new Date(now + 60_000).toISOString(),
  groupBy: "link",
});
console.log(`5. totals     ${JSON.stringify(stats.totals)}`);
const slugs = new Map([link, other].map((l) => [l.id, `/${l.slug}`]));
for (const row of stats.breakdown ?? []) {
  console.log(
    `   ${(slugs.get(row.key) ?? row.key).padEnd(8)} clicks=${row.clicks} leads=${row.leads} sales=${row.sales} revenue=${row.saleAmount}`,
  );
}
console.log(
  "   customers ",
  (await core.listCustomers("default")).map((c) => `${c.id} (${c.email})`),
);
