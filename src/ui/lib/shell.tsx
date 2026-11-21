/**
 * Shell context: the resolved `/config`, the active tenant and what the
 * current principal may do. Views read it instead of prop-drilling.
 *
 * @module
 */

import * as React from "react";
import type { LinksConfig } from "../types.ts";

/** Mutating actions (blocked in readonly mode). */
const MUTATING = new Set([
  "link:create",
  "link:update",
  "link:delete",
  "link:import",
  "domain:create",
  "domain:update",
  "domain:delete",
  "tenant:update",
  "tenant:delete",
]);

export interface Shell {
  config: LinksConfig;
  /** Active tenant ("" until tenants load). */
  tenant: string;
  /** Analytics viewer-token chrome (ADR 0009). */
  viewer: boolean;
  /** Whether the principal may perform `action` (viewer grants + readonly). */
  can: (action: string) => boolean;
  /** In-app navigation (keeps the tenant, honours the unsaved-changes guard). */
  go: (path: string) => void;
}

/** Permission check shared by the shell and tests. */
export function canPerform(
  config: Pick<LinksConfig, "readonly" | "viewer" | "allow">,
  action: string,
): boolean {
  if (config.readonly && MUTATING.has(action)) return false;
  if (!config.viewer) return true;
  return (config.allow ?? ["analytics:read", "link:read"]).includes(action);
}

export const ShellContext = React.createContext<Shell | null>(null);

export function useShell(): Shell {
  const ctx = React.useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used within the links App");
  return ctx;
}
