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
import {
  createHookErrorReporter,
  type HookErrorReporter as KitHookErrorReporter,
  type Hooks,
  type HooksInput,
} from "@xtandard/kit/hooks";

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
 * Throw from a `before` hook to deny a mutation with a specific HTTP status
 * (default `403`); any other thrown error also denies. The API layer maps it
 * by name, so it works across bundles.
 */
export { HookDeniedError, normalizeHooks, runAfter, runBefore } from "@xtandard/kit/hooks";

/** A control-plane hook. Implement `before`, `after`, or both. */
export type LinksHooks = Hooks<BeforeEvent, AfterEvent>;

/** Accepts a single hook, an array, or nothing. */
export type LinksHooksInput = HooksInput<BeforeEvent, AfterEvent>;

/** Reports an error thrown by an `after` hook. */
export type HookErrorReporter = KitHookErrorReporter<AfterEvent>;

/** Default `after`-hook error reporter: warn with the `[@xtandard/links]` prefix, never throw. */
export const defaultHookErrorReporter: HookErrorReporter =
  createHookErrorReporter("@xtandard/links");
