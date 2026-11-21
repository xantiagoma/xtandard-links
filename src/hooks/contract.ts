/**
 * Hook contracts — control-plane extensibility around admin mutations.
 *
 * A hook is plain JavaScript wired in at {@link ../core.createLinksCore} time
 * (never authored through the UI). Two phases, deliberately asymmetric:
 *
 * - **`before`** runs *before* a mutation commits. Throwing **denies** it.
 *   Hooks run sequentially in declared order; the first throw aborts. This is
 *   where plan limits live (links per month, custom domains per tenant).
 * - **`after`** runs *after* a mutation commits, for side effects (webhooks,
 *   audit, cache purges). Errors are isolated and reported via `onHookError`.
 *
 * Clicks are deliberately not hook events (redirect-plane traffic is hot); the
 * per-click tap is the redirect handler's fire-and-forget `onClick`.
 * Conversions (`lead.created`, `sale.created`) are `after` events.
 *
 * @module
 */

import type { Actor, Customer, Domain, LeadEvent, Link, SaleEvent, Tenant } from "../schema.ts";

/** Event delivered to {@link LinksHooks.before} — the *proposed* mutation. */
export type BeforeEvent =
  | { type: "link.create" | "link.update"; link: Link; previous?: Link; actor: Actor | null }
  | { type: "link.delete"; link: Link; actor: Actor | null }
  | { type: "domain.create" | "domain.update"; domain: Domain; actor: Actor | null }
  | { type: "domain.delete"; hostname: string; actor: Actor | null }
  | { type: "tenant.upsert"; tenant: Tenant; actor: Actor | null }
  | { type: "tenant.delete"; tenant: string; actor: Actor | null };

/** Event delivered to {@link LinksHooks.after} — the *committed* mutation. */
export type AfterEvent =
  | { type: "link.created"; link: Link; at: string; actor: Actor | null }
  | { type: "link.updated"; link: Link; previous: Link; at: string; actor: Actor | null }
  | { type: "link.deleted"; link: Link; at: string; actor: Actor | null }
  | {
      type: "domain.created" | "domain.updated" | "domain.deleted";
      domain: Domain;
      at: string;
      actor: Actor | null;
    }
  | { type: "tenant.upserted"; tenant: Tenant; at: string; actor: Actor | null }
  | { type: "tenant.deleted"; tenant: string; at: string; actor: Actor | null }
  | { type: "lead.created"; event: LeadEvent; customer: Customer; link: Link | null; at: string }
  | { type: "sale.created"; event: SaleEvent; customer: Customer; link: Link | null; at: string };

/** The discriminant strings of {@link BeforeEvent} / {@link AfterEvent}. */
export type BeforeEventType = BeforeEvent["type"];
export type AfterEventType = AfterEvent["type"];

/**
 * Thrown from a {@link LinksHooks.before} handler to **deny** a mutation with
 * a clean HTTP status (default `403`; e.g. `402`/`429` for plan limits).
 *
 * @example
 * ```ts
 * before(event) {
 *   if (event.type === "link.create" && overPlan(event.link.tenant)) {
 *     throw new HookDeniedError("Link limit reached for your plan.", { status: 402 });
 *   }
 * }
 * ```
 */
export class HookDeniedError extends Error {
  /** HTTP status the API layer should respond with. Default `403`. */
  readonly status: number;
  constructor(message: string, options?: { status?: number; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "HookDeniedError";
    this.status = options?.status ?? 403;
  }
}

/** A control-plane hook. Implement `before`, `after`, or both. */
export interface LinksHooks {
  /** Runs before a mutation commits. **Throw to deny.** */
  before?(event: BeforeEvent): void | Promise<void>;
  /** Runs after a mutation commits. Errors are reported, never rethrown. */
  after?(event: AfterEvent): void | Promise<void>;
}

/** Accepts a single hook, an array, or nothing. */
export type LinksHooksInput = LinksHooks | readonly LinksHooks[] | undefined;

/** Reports an error thrown by an `after` hook. */
export type HookErrorReporter = (error: unknown, event: AfterEvent) => void;

/** Normalize the `hooks` option into a flat array (empty when unset). */
export function normalizeHooks(input: LinksHooksInput): LinksHooks[] {
  if (!input) return [];
  return Array.isArray(input) ? [...input] : [input as LinksHooks];
}

/** Run every `before` hook sequentially; the first throw aborts. */
export async function runBefore(hooks: LinksHooks[], event: BeforeEvent): Promise<void> {
  for (const hook of hooks) {
    if (hook.before) await hook.before(event);
  }
}

/** Run every `after` hook, isolating failures. */
export async function runAfter(
  hooks: LinksHooks[],
  event: AfterEvent,
  onError: HookErrorReporter,
): Promise<void> {
  await Promise.all(
    hooks.map(async (hook) => {
      if (!hook.after) return;
      try {
        await hook.after(event);
      } catch (error) {
        onError(error, event);
      }
    }),
  );
}

/** Default `after`-hook error reporter: warn, but never throw. */
export const defaultHookErrorReporter: HookErrorReporter = (error, event) => {
  console.warn(`[@xtandard/links] after-hook for "${event.type}" threw:`, error);
};
