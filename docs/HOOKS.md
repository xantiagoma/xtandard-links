# Hooks

Control-plane extensibility around admin mutations, plus the redirect plane's per-click tap. Hooks
are plain JavaScript wired in when you create the core, never authored through the UI (that would
be remote code execution).

## The two phases

|         | `before`                                 | `after`                                                     |
| ------- | ---------------------------------------- | ----------------------------------------------------------- |
| Runs    | before a mutation commits                | after it commits, before the call returns                   |
| Order   | sequentially, in declared order          | concurrently                                                |
| Failure | **throw = deny**: nothing is written     | isolated; reported to `onHookError`, never fails the call   |
| Use for | plan limits, governance, naming policies | notifications, sync to your systems, webhooks, audit trails |

```ts
import { createLinksCore, HookDeniedError } from "@xtandard/links";

const core = createLinksCore({
  storage,
  hooks: {
    async before(event) {
      if (event.type === "link.create" && (await linksThisMonth(event.link.tenant)) >= 1000) {
        throw new HookDeniedError("Link limit reached for your plan.", { status: 402 });
      }
      if (
        event.type === "domain.create" &&
        event.domain.tenant &&
        !(await isPro(event.domain.tenant))
      ) {
        throw new HookDeniedError("Custom domains are a Pro feature.", { status: 402 });
      }
    },
    async after(event) {
      if (event.type === "sale.created") {
        await crm.recordRevenue(event.customer.id, event.event.amount, event.link?.slug);
      }
    },
  },
  onHookError: (error, event) => log.warn(`after-hook ${event.type} failed`, error),
});
```

`hooks` takes one hook or an array. `HookDeniedError` maps to its `status` (default 403) at the HTTP
API (`code: "HOOK_DENIED"`); any other error thrown from `before` maps like any core error (a
plain `Error` is a 500, treated as a bug rather than a policy). Framework adapters pass `hooks` and `onHookError` through `linksPanel(...)` when they
build the core.

## Event catalog

`before` events carry the **proposed** state and the `actor` (the authenticated principal for API
calls, or whatever you passed as `{ actor }`):

| Type                             | Payload                                               |
| -------------------------------- | ----------------------------------------------------- |
| `link.create`                    | `link` (its `slug` is `""` when it will be generated) |
| `link.update`                    | `link` (next), `previous`                             |
| `link.delete`                    | `link`                                                |
| `domain.create`, `domain.update` | `domain`                                              |
| `domain.delete`                  | `hostname`                                            |
| `tenant.upsert`                  | `tenant`                                              |
| `tenant.delete`                  | `tenant` (the key)                                    |

`after` events carry the **committed** state and `at`:

| Type                                                 | Payload                                             |
| ---------------------------------------------------- | --------------------------------------------------- |
| `link.created`, `link.deleted`                       | `link`, `actor`                                     |
| `link.updated`                                       | `link`, `previous`, `actor`                         |
| `domain.created`, `domain.updated`, `domain.deleted` | `domain`, `actor`                                   |
| `tenant.upserted`                                    | `tenant`, `actor`                                   |
| `tenant.deleted`                                     | `tenant` (the key), `actor`                         |
| `lead.created`, `sale.created`                       | `event` (LeadEvent / SaleEvent), `customer`, `link` |

Notes:

- **Imports** go through `createLink` / `updateLink`, so every imported row fires its own
  `before` and `after` events; a vetoed row is reported as an error row, the rest continue.
- **Cascades do not fire per link.** Deleting a tenant, or a domain with `force`, removes its links
  directly: you get one `tenant.delete` / `domain.delete` and its `after` event, not a
  `link.deleted` for each link.
- **Conversions have no veto.** `trackLead` / `trackSale` fire only `after` events.
- **Clicks are not hook events**, see below.
- Hooks are skipped in `readonly` mode because mutations are refused before they run.

## The click tap: `onClick`

Redirects are hot, anonymous traffic, so clicks deliberately do not go through hooks. The
per-click observer is the redirect handler's fire-and-forget `onClick`:

```ts
createRedirectHandler({
  core,
  onClick(event, link) {
    metrics.increment("short_link_clicks", {
      tenant: event.tenant,
      bot: String(event.bot),
      country: event.country ?? "unknown",
    });
  },
  onError: (error) => log.warn("redirect", error),
});
```

It runs in the background after the response is chosen, never awaited, and its errors go to
`onError`: a broken tap cannot slow or fail a redirect. It sees every **recorded** click, bots
included (`event.bot`); nothing is recorded (so nothing is tapped) with `ingestor: false`,
`bots: "drop"` for bots, or `respectDoNotTrack` for opted-out visitors.

## Bundled hooks and bridges

- **`@xtandard/links/hooks/log`**: `createLogHook({ log?, includeBefore?, format? })` logs each
  event; a pure observer that never denies, and the reference implementation to copy.

  ```ts
  import { createLogHook } from "@xtandard/links/hooks/log";
  createLinksCore({ storage, hooks: createLogHook() });
  ```

- **`@xtandard/links/bridges/webhooks`**: publish link and conversion events to your customers as
  outbound webhooks through [`@xtandard/webhooks`](https://github.com/xantiagoma/xtandard-webhooks)
  (structurally typed: anything with its `publish(app, { eventType, payload, idempotencyKey })`).

  ```ts
  import { webhooksBridge } from "@xtandard/links/bridges/webhooks";

  const bridge = webhooksBridge({
    webhooks: webhooksCore, // createWebhooksCore(...) from @xtandard/webhooks
    application: (tenant) => tenant, // tenant → webhooks application key; null = skip
    clicks: false, // true also publishes link.clicked for every non-bot click
    prefix: "links.", // optional event-type prefix
  });
  const core = createLinksCore({ storage, hooks: bridge.hooks });
  const redirects = createRedirectHandler({ core, onClick: bridge.onClick });
  // Register bridge.eventTypes in your webhooks event-type catalog.
  ```

  Event types: `link.created`, `link.updated`, `link.deleted` (payload `{ link }`, password hash
  stripped), `lead.created`, `sale.created` (`{ event, customer, link }`, idempotent on the event
  id), and `link.clicked` (`{ click, link }`) when `clicks` is on.

- **`@xtandard/links/bridges/audit`**: record every control-plane change and conversion in a
  per-tenant audit log your customers can see, through `@xtandard/audit` (structurally typed:
  anything with `record({ tenant, action, actor, targets, metadata })`).

  ```ts
  import { auditBridge } from "@xtandard/links/bridges/audit";

  createLinksCore({
    storage,
    hooks: [auditBridge({ audit, systemTenant: "default", prefix: "links." })],
  });
  ```

  Actions: `link.created|updated|deleted`, `domain.created|updated|deleted`,
  `tenant.upserted|deleted`, `lead.created`, `sale.created`. Changes to shared domains are recorded
  under `systemTenant`; a missing actor is recorded as `{ id: "system", type: "system" }`.

Separately, the core keeps its own small **operator audit log** in storage (the last
`auditLogLimit` entries, default 1000, per tenant, plus a global log), readable with
`core.listAudit(tenant?)` and `GET /api/tenants/:tenant/audit`. The audit bridge is for a durable,
customer-facing trail.
