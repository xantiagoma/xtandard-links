/**
 * A small, zero-dependency user-agent parser: device class, OS family and
 * browser family — enough for link analytics and rule targeting. Hosts that
 * need more can pass any `parseUserAgent` (e.g. one built on `ua-parser-js`).
 *
 * @module
 */

import type { DeviceType } from "../schema.ts";
import { isBot } from "./bots.ts";

/** Parsed user agent. */
export interface ParsedUserAgent {
  device: DeviceType;
  /** Lowercase OS family: `ios`, `android`, `windows`, `macos`, `linux`, `chromeos`, … or `unknown`. */
  os: string;
  /** Lowercase browser family: `chrome`, `safari`, `firefox`, `edge`, … or `unknown`. */
  browser: string;
  bot: boolean;
}

/** A user-agent parser. */
export type UserAgentParser = (userAgent: string) => ParsedUserAgent;

const OS_RULES: [RegExp, string][] = [
  [/iphone|ipod|ipad|ios\b|cfnetwork.*darwin/i, "ios"],
  [/android/i, "android"],
  [/cros/i, "chromeos"],
  [/windows phone/i, "windows-phone"],
  [/windows|win32|win64/i, "windows"],
  [/mac os x|macintosh|macos/i, "macos"],
  [/playstation|xbox|nintendo/i, "console"],
  [/tizen|webos|smart-?tv|roku|appletv|tvos/i, "tv"],
  [/linux|x11|ubuntu|fedora/i, "linux"],
];

const BROWSER_RULES: [RegExp, string][] = [
  [/edg(e|a|ios)?\//i, "edge"],
  [/opr\/|opera/i, "opera"],
  [/samsungbrowser/i, "samsung"],
  [/yabrowser/i, "yandex"],
  [/vivaldi/i, "vivaldi"],
  [/brave/i, "brave"],
  [/ucbrowser/i, "uc"],
  [/fban|fbav|instagram/i, "facebook"],
  [/line\//i, "line"],
  [/micromessenger/i, "wechat"],
  [/firefox|fxios/i, "firefox"],
  [/crios|chrome|chromium/i, "chrome"],
  [/safari|applewebkit/i, "safari"],
  [/msie|trident/i, "ie"],
];

/**
 * Parse a user agent into device / OS / browser families.
 *
 * @example
 * ```ts
 * parseUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) … Safari/604.1");
 * // { device: "mobile", os: "ios", browser: "safari", bot: false }
 * ```
 */
export function parseUserAgent(userAgent: string): ParsedUserAgent {
  const ua = userAgent ?? "";
  const bot = isBot(ua);
  const os = OS_RULES.find(([re]) => re.test(ua))?.[1] ?? "unknown";
  const browser = BROWSER_RULES.find(([re]) => re.test(ua))?.[1] ?? "unknown";
  let device: DeviceType;
  if (bot) device = "bot";
  else if (/ipad|tablet|kindle|silk|playbook|(android(?!.*mobile))/i.test(ua)) device = "tablet";
  else if (/mobi|iphone|ipod|android|windows phone|blackberry|opera mini/i.test(ua))
    device = "mobile";
  else if (os === "tv" || /smart-?tv|googletv|appletv|roku/i.test(ua)) device = "tv";
  else if (os === "console") device = "console";
  else if (os === "unknown" && browser === "unknown") device = "unknown";
  else device = "desktop";
  return { device, os, browser, bot };
}
