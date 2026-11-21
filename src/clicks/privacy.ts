/**
 * Privacy modes for click capture (ADR 0007): what happens to the client IP
 * and whether a daily-salted visitor hash is computed.
 *
 * @module
 */

import { sha256Hex } from "../password.ts";

/** Privacy options. Defaults are the most private useful setting. */
export interface PrivacyOptions {
  /**
   * What to store of the client IP: `"drop"` (default) stores nothing,
   * `"truncate"` zeroes the last IPv4 octet / last 80 IPv6 bits, `"hash"` stores a
   * daily-salted SHA-256, `"full"` stores it as-is.
   */
  ip?: "drop" | "truncate" | "hash" | "full";
  /**
   * `"daily-hash"` (default) derives a visitor id from IP + user agent + tenant +
   * a salt rotating daily, so uniques are countable per day without storing IPs.
   * `"none"` disables it.
   */
  visitor?: "daily-hash" | "none";
  /** Store the raw user agent on click events. Default `false`. */
  userAgent?: boolean;
  /** Skip recording clicks from browsers sending `DNT: 1` / `Sec-GPC: 1`. Default `false`. */
  respectDoNotTrack?: boolean;
  /** Secret mixed into the daily salt. Default: a per-process random value. */
  salt?: string;
}

const processSalt = (() => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
})();

/** The salt for a given UTC day. */
export function dailySalt(secret: string | undefined, at: number): string {
  return `${secret ?? processSalt}:${new Date(at).toISOString().slice(0, 10)}`;
}

/** Truncate an IP: last IPv4 octet → 0; IPv6 keeps the first 3 hextets. */
export function truncateIp(ip: string): string {
  if (ip.includes(".") && !ip.includes(":")) {
    const parts = ip.split(".");
    if (parts.length === 4) return `${parts.slice(0, 3).join(".")}.0`;
    return ip;
  }
  const hextets = ip.split(":").filter((p, i, a) => p !== "" || i === 0 || i === a.length - 1);
  return `${hextets.slice(0, 3).join(":")}::`;
}

/** Apply the IP privacy mode. */
export async function protectIp(
  ip: string | undefined,
  options: PrivacyOptions,
  at: number,
): Promise<string | undefined> {
  if (!ip) return undefined;
  switch (options.ip ?? "drop") {
    case "drop":
      return undefined;
    case "truncate":
      return truncateIp(ip);
    case "hash":
      return (await sha256Hex(`${dailySalt(options.salt, at)}|ip|${ip}`)).slice(0, 32);
    case "full":
      return ip;
  }
}

/** Compute the daily visitor hash, or `undefined` when disabled or no IP. */
export async function visitorHash(
  input: { ip: string | undefined; userAgent: string; tenant: string },
  options: PrivacyOptions,
  at: number,
): Promise<string | undefined> {
  if ((options.visitor ?? "daily-hash") === "none") return undefined;
  if (!input.ip) return undefined;
  const digest = await sha256Hex(
    `${dailySalt(options.salt, at)}|v|${input.tenant}|${input.ip}|${input.userAgent}`,
  );
  return digest.slice(0, 24);
}

/** Whether the request opted out of tracking (DNT / GPC). */
export function optedOut(request: Request): boolean {
  return request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1";
}
