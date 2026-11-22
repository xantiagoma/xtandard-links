/**
 * `@xtandard/links/hooks/log` — a reference hook that logs mutation events.
 *
 * The simplest possible consumer of the hooks seam: useful as a starting point
 * for your own `after` side effects, and handy for local debugging or piping
 * admin activity to a log aggregator. Zero dependencies.
 *
 * @example
 * ```ts
 * import { createLinksCore } from "@xtandard/links";
 * import { createLogHook } from "@xtandard/links/hooks/log";
 *
 * createLinksCore({ storage, hooks: createLogHook() });
 * ```
 *
 * @module
 */

import * as kit from "@xtandard/kit/hooks/log";
import type { AfterEvent, BeforeEvent, LinksHooks } from "./contract.ts";

/**
 * Options for {@link createLogHook}: `log` (default `console.log`),
 * `includeBefore`, `json` (one JSON object per line), `describe` (an extra
 * text-format field) and `format` (replaces the whole line).
 */
export type LogHookOptions = kit.LogHookOptions<BeforeEvent, AfterEvent>;

/**
 * Build a hook that logs each mutation event as
 * `[@xtandard/links] <phase> <type> <json>`. Never throws from `before`, so it
 * never denies a mutation — it is a pure observer.
 */
export function createLogHook(options: LogHookOptions = {}): LinksHooks {
  return kit.createLogHook<BeforeEvent, AfterEvent>({ source: "@xtandard/links", ...options });
}
