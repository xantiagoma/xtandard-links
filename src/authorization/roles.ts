/**
 * Role-based {@link AuthorizationProvider}. Maps each role name to the set of
 * {@link LinksAction}s it grants, then allows an action when *any* of the
 * principal's roles grants it.
 *
 * The policy is a flat `Record<roleName, LinksAction[] | "*">` — `"*"` is a
 * wildcard granting every action. When no `policy` is supplied, the built-in
 * {@link DEFAULT_ROLE_POLICY} applies (`admin`/`editor`/`viewer`).
 *
 * A `readonly` switch denies every {@link isMutatingAction mutating} action
 * regardless of role — handy for read-only mirrors or "break glass" lockdowns.
 *
 * @module
 */

import type { AuthorizationProvider, AuthorizeInput, LinksAction } from "./contract.ts";
import { isMutatingAction } from "./contract.ts";

/** Every action in the system, used to expand non-wildcard "all actions" presets. */
export const ALL_ACTIONS: readonly LinksAction[] = [
  "tenant:read",
  "tenant:update",
  "tenant:delete",
  "domain:read",
  "domain:create",
  "domain:update",
  "domain:delete",
  "link:read",
  "link:create",
  "link:update",
  "link:delete",
  "link:import",
  "analytics:read",
  "customer:read",
  "audit:read",
  "conversion:track",
  "viewer-token:create",
];

/**
 * Every read-only action (the `*:read` subset of {@link ALL_ACTIONS}). Minting
 * viewer tokens and tracking conversions are not reads and must be granted
 * explicitly.
 */
export const READ_ACTIONS: readonly LinksAction[] = ALL_ACTIONS.filter((a) => a.endsWith(":read"));

/** A role policy: each role maps to an explicit action list or the `"*"` wildcard. */
export type RolePolicy = Record<string, LinksAction[] | "*">;

/**
 * The default role policy applied when {@link RolesAuthorizationOptions.policy}
 * is omitted.
 *
 * - `admin` — `"*"`, every action.
 * - `editor` — every action (explicit list, equivalent to `admin` here).
 * - `viewer` — every `*:read` action only.
 */
export const DEFAULT_ROLE_POLICY: RolePolicy = {
  admin: "*",
  editor: [...ALL_ACTIONS],
  viewer: [...READ_ACTIONS],
};

/** Options for {@link rolesAuthorization}. */
export interface RolesAuthorizationOptions {
  /**
   * Role → granted actions. `"*"` grants everything. Defaults to
   * {@link DEFAULT_ROLE_POLICY} when omitted.
   */
  policy?: RolePolicy;
  /**
   * When `true`, every {@link isMutatingAction mutating} action is denied
   * regardless of the principal's roles.
   * @default false
   */
  readonly?: boolean;
}

/**
 * Create a role-based {@link AuthorizationProvider}.
 *
 * Decision order:
 * 1. If `readonly` and the action mutates → **deny**.
 * 2. If the principal is `null` → **deny**.
 * 3. If any of the principal's roles grants the action (via `"*"` or an explicit
 *    list) → **allow**; otherwise **deny**.
 *
 * @example
 * ```ts
 * import { rolesAuthorization } from "@xtandard/links/authorization/roles";
 *
 * // Built-in admin/editor/viewer policy:
 * const authz = rolesAuthorization();
 *
 * // Custom policy:
 * const custom = rolesAuthorization({
 *   policy: {
 *     marketing: ["link:read", "link:create", "link:update", "analytics:read"],
 *     tracker: ["conversion:track"],
 *   },
 * });
 * ```
 */
export function rolesAuthorization(options: RolesAuthorizationOptions = {}): AuthorizationProvider {
  const policy = options.policy ?? DEFAULT_ROLE_POLICY;
  const readonly = options.readonly ?? false;

  // Pre-compute each role's granted action set for O(1) lookups. A role mapped
  // to "*" is recorded as `null` (wildcard).
  const grants = new Map<string, Set<LinksAction> | null>();
  for (const [role, actions] of Object.entries(policy)) {
    grants.set(role, actions === "*" ? null : new Set(actions));
  }

  return {
    async authorize(input: AuthorizeInput): Promise<boolean> {
      if (readonly && isMutatingAction(input.action)) return false;

      const principal = input.principal;
      if (!principal) return false;

      const roles = principal.roles;
      if (!roles || roles.length === 0) return false;

      for (const role of roles) {
        if (!grants.has(role)) continue;
        const granted = grants.get(role);
        if (granted === null) return true; // wildcard
        if (granted?.has(input.action)) return true;
      }
      return false;
    },
  };
}
