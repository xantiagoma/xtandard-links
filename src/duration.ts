/**
 * Duration parsing for {@link ./schema.LinksDuration} config values. Zero
 * dependencies.
 *
 * @module
 */

import type { LinksDuration } from "./schema.ts";

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const DURATION_RE = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/;

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
  if (typeof duration === "number") {
    if (!Number.isFinite(duration) || duration < 0) {
      throw new Error(`Invalid duration: ${duration}`);
    }
    return duration;
  }
  const match = DURATION_RE.exec(duration.trim());
  if (!match) throw new Error(`Invalid duration: "${duration}" (expected e.g. "5s", "30m", "2h")`);
  return Number(match[1]) * (UNIT_MS[match[2] as string] as number);
}
