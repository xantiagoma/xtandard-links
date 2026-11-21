/**
 * Bridges, in one script (no server):
 *
 * - `bridges/webhooks` publishes link lifecycle, conversion and (opt-in) click
 *   events to your customers through `@xtandard/webhooks`;
 * - `bridges/audit` records every control-plane change and conversion in an
 *   `@xtandard/audit` log.
 *
 *   bun run src/index.ts
 *
 * Both bridges are typed structurally — they don't import the other packages —
 * so this example passes tiny fakes that print what they receive. In an app,
 * pass the real `webhooksCore` / `audit` instances instead.
 */
import { auditBridge, type AuditRecorder } from "@xtandard/links/bridges/audit";
import { webhooksBridge, type WebhooksPublisher } from "@xtandard/links/bridges/webhooks";
import { clickRequest, createTestLinks } from "@xtandard/links/testing";

// --- Stand-ins for @xtandard/webhooks and @xtandard/audit -----------------------
const webhooks: WebhooksPublisher = {
  async publish(applicationKey, { eventType, payload, idempotencyKey }) {
    const summary = JSON.stringify(payload).slice(0, 70);
    console.log(
      `  webhook → app=${applicationKey} ${eventType.padEnd(13)} key=${idempotencyKey ?? "-"} ${summary}…`,
    );
    return { ok: true };
  },
};
const audit: AuditRecorder = {
  async record({ tenant, action, actor, targets, metadata }) {
    const target = targets?.map((t) => `${t.type}:${t.name ?? t.id}`).join(",");
    console.log(
      `  audit   → tenant=${tenant} ${action.padEnd(14)} by ${actor?.id} on ${target} ${metadata ? JSON.stringify(metadata) : ""}`,
    );
    return { ok: true };
  },
};

// --- Wiring ------------------------------------------------------------------------
const bridge = webhooksBridge({
  webhooks,
  clicks: true, // publish link.clicked too (off by default: clicks are hot)
  // Map tenants to webhooks applications; `null` skips publishing for a tenant.
  application: (tenant) => (tenant === "internal" ? null : `links-${tenant}`),
});
console.log("register these event types in your webhooks catalog:", bridge.eventTypes.join(", "));

const { core, redirects, flush } = createTestLinks({
  defaultDomain: "go.acme.com",
  hooks: [bridge.hooks, auditBridge({ audit })], // control-plane events
  redirect: { onClick: bridge.onClick }, // the click tap (redirect plane)
});

// --- Activity ------------------------------------------------------------------------
const actor = { actor: { id: "usr_ada", name: "Ada" } };

console.log("\ncreate a link");
const link = await core.createLink(
  { tenant: "acme", slug: "launch", url: "https://acme.com/launch", trackConversions: true },
  actor,
);

console.log("\nupdate it");
await core.updateLink("acme", link.id, { title: "Launch page" }, actor);

console.log("\nclick it");
const res = await redirects.fetch(clickRequest("https://go.acme.com/launch"));
await flush();

console.log("\nconvert");
const clickId = new URL(res.headers.get("location")!).searchParams.get("xl_id")!;
await core.trackLead({ tenant: "acme", clickId, customerId: "cus_1" });
await core.trackSale({ tenant: "acme", customerId: "cus_1", amount: 1900, invoiceId: "inv_9" });

console.log("\ndelete it");
await core.deleteLink("acme", link.id, actor);
