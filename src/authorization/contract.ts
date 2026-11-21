/**
 * Authorization contract. Answers: "Can this principal perform this action on
 * this resource?"
 *
 * Every admin API route consults the {@link AuthorizationProvider} (except for
 * analytics viewer principals, which are force-scoped by their token).
 * Ships `none`/`roles`/`delegated` implementations.
 *
 * @module
 */

import type { Principal } from "../auth/contract.ts";

/** The full set of authorizable actions. */
export type LinksAction =
  | "tenant:read"
  | "tenant:update"
  | "tenant:delete"
  | "domain:read"
  | "domain:create"
  | "domain:update"
  | "domain:delete"
  | "link:read"
  | "link:create"
  | "link:update"
  | "link:delete"
  | "link:import"
  | "analytics:read"
  | "customer:read"
  | "audit:read"
  | "conversion:track"
  | "viewer-token:create";

/**
 * The resource an action targets. Every resource carries the `tenant` it
 * belongs to (`"*"` for "all tenants", e.g. listing tenants; absent for shared
 * domains and the global audit log), plus the link id or hostname when the
 * action targets one record.
 */
export type LinksResource =
  | { type: "tenant"; tenant: string }
  | { type: "domain"; hostname: string; tenant?: string }
  | { type: "link"; tenant: string; linkId?: string }
  | { type: "analytics"; tenant: string; linkIds?: string[] }
  | { type: "customer"; tenant: string }
  | { type: "audit"; tenant?: string }
  | { type: "conversion"; tenant: string }
  | { type: "viewer-token"; tenant: string };

/** Input passed to {@link AuthorizationProvider.authorize}. */
export interface AuthorizeInput {
  principal: Principal | null;
  action: LinksAction;
  resource: LinksResource;
  request: Request;
}

/** Decides whether an action is permitted. */
export interface AuthorizationProvider {
  authorize(input: AuthorizeInput): Promise<boolean>;
}

/** Actions that mutate state — blocked in readonly mode. */
export const MUTATING_ACTIONS: ReadonlySet<LinksAction> = new Set<LinksAction>([
  "tenant:update",
  "tenant:delete",
  "domain:create",
  "domain:update",
  "domain:delete",
  "link:create",
  "link:update",
  "link:delete",
  "link:import",
  "conversion:track",
]);

/** True if the action mutates state. */
export const isMutatingAction = (action: LinksAction): boolean => MUTATING_ACTIONS.has(action);
