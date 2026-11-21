# webhooks-bridge × @xtandard/links

Two bridges that turn link activity into events for the rest of the xtandard
ecosystem — wired as core `hooks` (control plane) and the redirect handler's
`onClick` tap (redirect plane):

```ts
import { webhooksBridge } from "@xtandard/links/bridges/webhooks";
import { auditBridge } from "@xtandard/links/bridges/audit";

const bridge = webhooksBridge({ webhooks: webhooksCore, clicks: true });
const core = createLinksCore({ storage, hooks: [bridge.hooks, auditBridge({ audit })] });
const redirects = createRedirectHandler({ core, onClick: bridge.onClick });
```

- **`bridges/webhooks`** publishes `link.created|updated|deleted`, `lead.created`,
  `sale.created` and (with `clicks: true`) `link.clicked` through anything with
  `@xtandard/webhooks`' `publish(applicationKey, { eventType, payload, idempotencyKey })`.
  `application(tenant)` maps a tenant to a webhooks application (`null` = skip);
  `bridge.eventTypes` lists what to register in your catalog.
- **`bridges/audit`** records `link.*`, `domain.*`, `tenant.*`, `lead.created` and
  `sale.created` through anything with `@xtandard/audit`'s
  `record({ tenant, action, actor, targets, metadata })`.

Both are typed structurally, so this example passes printing fakes — no other
package required.

## Run it

```bash
# from the repo root (build once first: bun run build)
bun scripts/example.ts webhooks-bridge

# or in this directory
bun install
bun run start
```
