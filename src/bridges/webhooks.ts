/**
 * Bridge to `@xtandard/webhooks`: publish link lifecycle and conversion events
 * (and, optionally, clicks) as outbound webhooks to your customers.
 *
 * Structural typing only — this module does not import `@xtandard/webhooks`;
 * pass anything with its `publish(applicationKey, { eventType, payload })`.
 *
 * ```ts
 * import { webhooksBridge } from "@xtandard/links/bridges/webhooks";
 *
 * const bridge = webhooksBridge({ webhooks: webhooksCore });
 * const core = createLinksCore({ storage, hooks: bridge.hooks });
 * const redirects = createRedirectHandler({ core, onClick: bridge.onClick });
 * ```
 *
 * Event types: `link.created`, `link.updated`, `link.deleted`, `lead.created`,
 * `sale.created`, and `link.clicked` (only when `clicks` is enabled). The
 * webhooks application key defaults to the link's tenant.
 *
 * @module
 */

import type { AfterEvent, LinksHooks } from "../hooks/contract.ts";
import { publicLink } from "../core.ts";
import type { ClickEvent, JsonValue, Link } from "../schema.ts";

/** The slice of `@xtandard/webhooks`' core this bridge needs. */
export interface WebhooksPublisher {
  publish(
    applicationKey: string,
    input: { eventType: string; payload: JsonValue; idempotencyKey?: string },
  ): Promise<unknown>;
}

/** Options for {@link webhooksBridge}. */
export interface WebhooksBridgeOptions {
  webhooks: WebhooksPublisher;
  /** Map a tenant to a webhooks application key (`null` = don't publish). Default: identity. */
  application?: (tenant: string) => string | null;
  /** Publish `link.clicked` for every non-bot click. Default `false` (clicks are hot). */
  clicks?: boolean;
  /** Prefix for event types, e.g. `"links."`. Default `""`. */
  prefix?: string;
  /** Errors from `publish` (missing application, unknown event type, …). Default `console.warn`. */
  onError?: (error: unknown) => void;
}

/** The hooks + click tap to wire into the core and redirect handler. */
export interface WebhooksBridge {
  hooks: LinksHooks;
  onClick: (event: ClickEvent, link: Link) => void;
  /** The event types this bridge publishes (register them in your webhooks catalog). */
  eventTypes: string[];
}

const toJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as JsonValue;

/** Create the bridge. */
export function webhooksBridge(options: WebhooksBridgeOptions): WebhooksBridge {
  const prefix = options.prefix ?? "";
  const application = options.application ?? ((tenant: string) => tenant);
  const onError =
    options.onError ?? ((e: unknown) => console.warn("[@xtandard/links] webhooks bridge:", e));
  const publish = async (tenant: string, type: string, payload: unknown, key?: string) => {
    const app = application(tenant);
    if (!app) return;
    try {
      await options.webhooks.publish(app, {
        eventType: `${prefix}${type}`,
        payload: toJson(payload),
        ...(key ? { idempotencyKey: key } : {}),
      });
    } catch (error) {
      onError(error);
    }
  };
  const eventTypes = [
    "link.created",
    "link.updated",
    "link.deleted",
    "lead.created",
    "sale.created",
  ];
  if (options.clicks) eventTypes.push("link.clicked");
  return {
    eventTypes: eventTypes.map((t) => `${prefix}${t}`),
    hooks: {
      async after(event: AfterEvent) {
        switch (event.type) {
          case "link.created":
          case "link.updated":
          case "link.deleted":
            return publish(event.link.tenant, event.type, { link: publicLink(event.link) });
          case "lead.created":
          case "sale.created":
            return publish(
              event.event.tenant,
              event.type,
              {
                event: event.event,
                customer: event.customer,
                link: event.link ? publicLink(event.link) : null,
              },
              event.event.id,
            );
        }
      },
    },
    onClick(event, link) {
      if (!options.clicks || event.bot) return;
      void publish(
        event.tenant,
        "link.clicked",
        { click: event, link: publicLink(link) },
        event.id,
      );
    },
  };
}
