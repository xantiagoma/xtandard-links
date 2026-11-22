/**
 * Entity ids: `{prefix}_{10-char time}{16-char random}` in Crockford base32
 * (ULID layout). Ids sort lexicographically by creation time — click ids
 * double as an ordering key for raw event logs. Zero dependencies (Web Crypto).
 *
 * The generator is `@xtandard/kit/util`'s `createIdGenerator` in the `ulid`
 * format (ids are stored data, so the format never changes): integer
 * milliseconds, monotonic within a process.
 *
 * @module
 */

import { createIdGenerator } from "@xtandard/kit/util";

/** Prefixes for generated ids. */
export type IdPrefix = "lnk" | "clk" | "lead" | "sale" | "rule";

const ids = createIdGenerator<IdPrefix>({
  format: "ulid",
  prefixes: ["lnk", "clk", "lead", "sale", "rule"],
});

/**
 * Generate a new time-sortable id, e.g. `newId("lnk")` → `"lnk_01JD…"`. Ids
 * minted in the same (or an earlier) millisecond increment the previous random
 * part, so creation order and sort order always agree.
 *
 * @example
 * ```ts
 * import { newId } from "@xtandard/links";
 *
 * newId("clk"); // "clk_01JDB6Z…"
 * ```
 */
export function newId(prefix: IdPrefix, now: number = Date.now()): string {
  return ids.newId(prefix, now);
}

/** Regex an id of the given prefix must match. */
export function idPattern(prefix: IdPrefix): RegExp {
  return ids.idPattern(prefix);
}

/** The creation time (epoch millis) encoded in an id, or `NaN` if malformed. */
export function idTime(id: string): number {
  return ids.idTime(id) ?? Number.NaN;
}
