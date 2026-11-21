/**
 * Bridge to `@xtandard/audit`: record every control-plane change (links,
 * domains, tenants) and conversion into a tamper-evident, per-tenant audit log
 * your customers can see.
 *
 * Structural typing only — this module does not import `@xtandard/audit`;
 * pass anything with its `record({ tenant, action, actor, targets, metadata })`.
 *
 * ```ts
 * import { auditBridge } from "@xtandard/links/bridges/audit";
 *
 * const core = createLinksCore({ storage, hooks: auditBridge({ audit }) });
 * ```
 *
 * Actions: `link.created|updated|deleted`, `domain.created|updated|deleted`,
 * `tenant.upserted|deleted`, `lead.created`, `sale.created`.
 *
 * @module
 */

import type { AfterEvent, LinksHooks } from "../hooks/contract.ts";
import type { Actor, JsonObject } from "../schema.ts";

/** The slice of `@xtandard/audit`'s core this bridge needs. */
export interface AuditRecorder {
  record(input: {
    tenant: string;
    action: string;
    occurredAt?: string;
    actor?: { id: string; type?: string; name?: string; email?: string };
    targets?: { type: string; id: string; name?: string }[];
    metadata?: JsonObject;
  }): Promise<unknown>;
}

/** Options for {@link auditBridge}. */
export interface AuditBridgeOptions {
  audit: AuditRecorder;
  /** Tenant used for shared (tenant-less) domains. Default `"default"`. */
  systemTenant?: string;
  /** Action prefix, e.g. `"links."`. Default `""`. */
  prefix?: string;
  /** Errors from `record`. Default `console.warn`. */
  onError?: (error: unknown) => void;
}

const actorOf = (actor: Actor | null | undefined) =>
  actor
    ? {
        id: actor.id,
        ...(actor.name ? { name: actor.name } : {}),
        ...(actor.email ? { email: actor.email } : {}),
      }
    : { id: "system", type: "system" };

/** Create the hook. Pass it (or include it in an array) as the core's `hooks`. */
export function auditBridge(options: AuditBridgeOptions): LinksHooks {
  const prefix = options.prefix ?? "";
  const systemTenant = options.systemTenant ?? "default";
  const onError =
    options.onError ?? ((e: unknown) => console.warn("[@xtandard/links] audit bridge:", e));
  const record = async (input: Parameters<AuditRecorder["record"]>[0]) => {
    try {
      await options.audit.record({ ...input, action: `${prefix}${input.action}` });
    } catch (error) {
      onError(error);
    }
  };
  return {
    async after(event: AfterEvent) {
      switch (event.type) {
        case "link.created":
        case "link.updated":
        case "link.deleted": {
          const link = event.link;
          const metadata: JsonObject = { domain: link.domain, slug: link.slug, url: link.url };
          if (event.type === "link.updated") {
            const changed = Object.keys(link).filter(
              (k) =>
                k !== "updatedAt" &&
                JSON.stringify((link as unknown as Record<string, unknown>)[k]) !==
                  JSON.stringify((event.previous as unknown as Record<string, unknown>)[k]),
            );
            metadata.changed = changed;
          }
          return record({
            tenant: link.tenant,
            action: event.type,
            occurredAt: event.at,
            actor: actorOf(event.actor),
            targets: [{ type: "link", id: link.id, name: `${link.domain}/${link.slug}` }],
            metadata,
          });
        }
        case "domain.created":
        case "domain.updated":
        case "domain.deleted":
          return record({
            tenant: event.domain.tenant ?? systemTenant,
            action: event.type,
            occurredAt: event.at,
            actor: actorOf(event.actor),
            targets: [{ type: "domain", id: event.domain.hostname }],
          });
        case "tenant.upserted":
          return record({
            tenant: event.tenant.key,
            action: event.type,
            occurredAt: event.at,
            actor: actorOf(event.actor),
            targets: [{ type: "tenant", id: event.tenant.key }],
          });
        case "tenant.deleted":
          return record({
            tenant: event.tenant,
            action: event.type,
            occurredAt: event.at,
            actor: actorOf(event.actor),
            targets: [{ type: "tenant", id: event.tenant }],
          });
        case "lead.created":
        case "sale.created":
          return record({
            tenant: event.event.tenant,
            action: event.type,
            occurredAt: event.at,
            actor: { id: event.customer.id, type: "customer" },
            targets: [{ type: "link", id: event.event.linkId }],
            metadata:
              event.event.type === "sale"
                ? { amount: event.event.amount, currency: event.event.currency }
                : { name: event.event.name },
          });
      }
    },
  };
}
