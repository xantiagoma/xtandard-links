/**
 * Entity ids: `{prefix}_{10-char time}{16-char random}` in Crockford base32
 * (ULID layout). Ids sort lexicographically by creation time — click ids
 * double as an ordering key for raw event logs. Zero dependencies (Web Crypto).
 *
 * @module
 */

/** Prefixes for generated ids. */
export type IdPrefix = "lnk" | "clk" | "lead" | "sale" | "rule";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(millis: number): string {
  let out = "";
  let t = Math.floor(millis);
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return out;
}

function randomPart(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % 32];
  return out;
}

/**
 * Generate a new time-sortable id, e.g. `newId("lnk")` → `"lnk_01JD…"`.
 *
 * @example
 * ```ts
 * import { newId } from "@xtandard/links";
 *
 * newId("clk"); // "clk_01JDB6Z…"
 * ```
 */
export function newId(prefix: IdPrefix, now: number = Date.now()): string {
  return `${prefix}_${encodeTime(now)}${randomPart(16)}`;
}

/** Regex an id of the given prefix must match. */
export function idPattern(prefix: IdPrefix): RegExp {
  return new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`);
}

/** The creation time (epoch millis) encoded in an id, or `NaN` if malformed. */
export function idTime(id: string): number {
  const body = id.slice(id.indexOf("_") + 1, id.indexOf("_") + 11);
  if (body.length !== 10) return Number.NaN;
  let t = 0;
  for (const ch of body) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return Number.NaN;
    t = t * 32 + v;
  }
  return t;
}
