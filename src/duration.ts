/**
 * Duration parsing for {@link ./schema.LinksDuration} config values. Zero
 * dependencies; the parser is `@xtandard/kit/util`'s.
 *
 * @module
 */

import { durationToMs as kitDurationToMs } from "@xtandard/kit/util";
import type { LinksDuration } from "./schema.ts";

/**
 * Convert a {@link LinksDuration} (`5000`, `"5s"`, `"30m"`, `"2h"`, `"90d"`)
 * to milliseconds. Throws on malformed strings or negative numbers.
 *
 * @example
 * ```ts
 * import { durationToMs } from "@xtandard/links";
 *
 * durationToMs("5m"); // 300000
 * ```
 */
export function durationToMs(duration: LinksDuration): number {
  return kitDurationToMs(duration);
}
