/**
 * Deep links (ADR 0008): builders for the OS association files served from
 * a short domain's `/.well-known/`, Play Store install-referrer tagging, and
 * the coarse fingerprint used for probabilistic deferred deep-link matching.
 * Zero dependencies; edge-safe.
 *
 * Import from `@xtandard/links/deeplinks` (also re-exported by the root).
 *
 * @module deeplinks
 */

import { sha256Hex } from "./password.ts";
import type { AndroidAppConfig, Domain, IosAppConfig } from "./schema.ts";

/** Path of the Apple association file. */
export const AASA_PATH = "/.well-known/apple-app-site-association";
/** Path of the Android Digital Asset Links file. */
export const ASSETLINKS_PATH = "/.well-known/assetlinks.json";

/**
 * Build an `apple-app-site-association` document (universal links + web
 * credentials) for an iOS app config.
 *
 * @example
 * ```ts
 * buildAppleAppSiteAssociation({ appIds: ["ABCDE12345.com.acme.app"] });
 * ```
 */
export function buildAppleAppSiteAssociation(ios: IosAppConfig): Record<string, unknown> {
  const components =
    ios.paths && ios.paths.length > 0
      ? ios.paths.map((p) =>
          p.startsWith("NOT ") ? { "/": p.slice(4), exclude: true } : { "/": p },
        )
      : [{ "/": "*" }];
  return {
    applinks: { details: [{ appIDs: ios.appIds, components }] },
    webcredentials: { apps: ios.appIds },
  };
}

/** Build an `assetlinks.json` document for Android app configs. */
export function buildAssetLinks(android: readonly AndroidAppConfig[]): unknown[] {
  return android.map((app) => ({
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: app.packageName,
      sha256_cert_fingerprints: app.sha256CertFingerprints.map((f) => f.toUpperCase()),
    },
  }));
}

/**
 * Serve a domain's association files. Returns `null` for other paths or when
 * the domain has no matching app config.
 */
export function wellKnownResponse(domain: Domain, pathname: string): Response | null {
  const headers = {
    "content-type": "application/json",
    "cache-control": "public, max-age=3600",
  };
  if (pathname === AASA_PATH || pathname === `${AASA_PATH}.json`) {
    if (!domain.apps?.ios) return null;
    return new Response(JSON.stringify(buildAppleAppSiteAssociation(domain.apps.ios)), { headers });
  }
  if (pathname === ASSETLINKS_PATH) {
    if (!domain.apps?.android?.length) return null;
    return new Response(JSON.stringify(buildAssetLinks(domain.apps.android)), { headers });
  }
  return null;
}

/** True for Google Play listing URLs (`play.google.com/store/apps/details`, `market://`). */
export function isPlayStoreUrl(url: string): boolean {
  return /^market:\/\/details|^https:\/\/play\.google\.com\/store\/apps\/details/i.test(url);
}

/**
 * Tag a Play Store URL with the install referrer so the freshly installed app
 * can read the click id via the Play Install Referrer API:
 * `&referrer=xl_id%3D{clickId}`. Non-Play URLs are returned unchanged.
 */
export function withInstallReferrer(url: string, clickId: string, param = "xl_id"): string {
  if (!isPlayStoreUrl(url)) return url;
  try {
    const u = new URL(url);
    const existing = u.searchParams.get("referrer");
    const referrer = new URLSearchParams(existing ?? "");
    referrer.set(param, clickId);
    u.searchParams.set("referrer", referrer.toString());
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * The coarse fingerprint for probabilistic deferred matching: a daily-salted
 * hash of IP + OS family. The same visitor tapping a link in the browser and
 * opening the freshly installed app minutes later usually shares both. IPs are
 * never stored.
 */
export async function deferredFingerprint(input: {
  ip: string | undefined;
  os: string;
  salt: string;
}): Promise<string | undefined> {
  if (!input.ip) return undefined;
  return (await sha256Hex(`${input.salt}|df|${input.ip}|${input.os.toLowerCase()}`)).slice(0, 32);
}
