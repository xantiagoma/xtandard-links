/**
 * Analytics viewer tokens (ADR 0009) — the credential behind the embeddable
 * per-tenant analytics widget.
 *
 * A viewer token is a compact HMAC-signed grant scoping its bearer to exactly
 * **one tenant** (optionally to a set of its links) and a set of actions, for a
 * limited time. The host mints tokens server-side with {@link createViewerToken}
 * (the secret never reaches a browser) and hands them to its frontend; the
 * panel verifies them with {@link verifyViewerToken} and force-scopes every
 * request to the token's grant (see the `portal` panel option). The host's
 * authorization provider is not consulted for viewer principals.
 *
 * Wire format:
 *
 * ```txt
 * lvt_<base64url(JSON { tenant, links?, allow?, exp })>.<base64url(HMAC-SHA256(secret, payloadPart))>
 * ```
 *
 * Zero dependencies (Web Crypto only). The secret is an arbitrary string, fed
 * to the HMAC as raw UTF-8 bytes. Revoking tokens before they expire means
 * rotating the secret.
 *
 * @module
 */

import type { LinksAction } from "./authorization/contract.ts";
import { durationToMs } from "./duration.ts";
import { base64url, fromBase64url, hmacSha256, timingSafeEqual } from "./password.ts";
import type { LinksDuration } from "./schema.ts";

/** Prefix of every viewer token. */
export const VIEWER_TOKEN_PREFIX = "lvt_";

/** Default token lifetime. */
export const DEFAULT_VIEWER_TOKEN_EXPIRES_IN: LinksDuration = "1d";

/** What a viewer may do when neither the token nor the panel says otherwise. */
export const DEFAULT_VIEWER_ACTIONS: readonly LinksAction[] = ["analytics:read", "link:read"];

/**
 * Actions a viewer token can ever grant. Everything here is confined to the
 * token's tenant (and link set); tenant/domain management, the global audit log
 * and minting further tokens are never grantable.
 */
export const VIEWER_GRANTABLE_ACTIONS: readonly LinksAction[] = [
  "tenant:read",
  "domain:read",
  "link:read",
  "link:create",
  "link:update",
  "link:delete",
  "link:import",
  "analytics:read",
  "customer:read",
  "audit:read",
  "conversion:track",
];

/**
 * Thrown by {@link verifyViewerToken} for any invalid token — malformed, bad
 * signature, or expired — and by {@link createViewerToken} for invalid input.
 * Maps to HTTP 401 at the API layer.
 */
export class ViewerTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ViewerTokenError";
  }
}

/** Options for {@link createViewerToken}. */
export interface ViewerTokenOptions {
  /** The tenant the token grants access to. */
  tenant: string;
  /** Restrict the token to these link ids. Unset = every link of the tenant. */
  links?: string[];
  /**
   * Actions the token grants. Unset = the panel's `portal.allow`, then
   * {@link DEFAULT_VIEWER_ACTIONS}. Only {@link VIEWER_GRANTABLE_ACTIONS} take effect.
   */
  allow?: LinksAction[];
  /** Token lifetime. Default `"1d"`. */
  expiresIn?: LinksDuration;
}

/** The claims carried inside a viewer token. */
export interface ViewerTokenClaims {
  tenant: string;
  links?: string[];
  allow?: LinksAction[];
  /** Expiry, unix epoch milliseconds. */
  exp: number;
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

/**
 * Mint a viewer token. Call this **server-side** — anyone holding the secret
 * can mint tokens for any tenant.
 *
 * @example
 * ```ts
 * import { createViewerToken } from "@xtandard/links";
 *
 * // In the host app's session-guarded route:
 * const token = await createViewerToken(process.env.LINKS_VIEWER_SECRET!, {
 *   tenant: session.workspaceId,
 *   expiresIn: "1h",
 * });
 * // Hand `token` to <LinkAnalytics token={token} />.
 * ```
 */
export async function createViewerToken(
  secret: string,
  options: ViewerTokenOptions,
): Promise<string> {
  if (!secret) throw new ViewerTokenError("A viewer token secret is required");
  if (typeof options.tenant !== "string" || options.tenant.length === 0) {
    throw new ViewerTokenError("A viewer token needs a tenant");
  }
  const expiresInMs = durationToMs(options.expiresIn ?? DEFAULT_VIEWER_TOKEN_EXPIRES_IN);
  const claims: ViewerTokenClaims = {
    tenant: options.tenant,
    ...(options.links ? { links: [...options.links] } : {}),
    ...(options.allow ? { allow: [...options.allow] } : {}),
    exp: Date.now() + expiresInMs,
  };
  const payloadPart = base64url(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = base64url(await hmacSha256(secret, payloadPart));
  return `${VIEWER_TOKEN_PREFIX}${payloadPart}.${signature}`;
}

/**
 * Verify a viewer token: format, signature (constant time), then expiry.
 * Returns the claims on success; throws {@link ViewerTokenError} otherwise.
 *
 * @example
 * ```ts
 * import { verifyViewerToken } from "@xtandard/links";
 *
 * const { tenant, links } = await verifyViewerToken(secret, token);
 * ```
 */
export async function verifyViewerToken(secret: string, token: string): Promise<ViewerTokenClaims> {
  if (!token.startsWith(VIEWER_TOKEN_PREFIX)) {
    throw new ViewerTokenError("Invalid viewer token: missing lvt_ prefix");
  }
  const parts = token.slice(VIEWER_TOKEN_PREFIX.length).split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new ViewerTokenError("Invalid viewer token: malformed");
  }
  const [payloadPart, signaturePart] = parts as [string, string];

  // Signature first: never interpret unauthenticated claims.
  let candidate: Uint8Array;
  try {
    candidate = fromBase64url(signaturePart);
  } catch {
    throw new ViewerTokenError("Invalid viewer token: malformed signature");
  }
  const expected = await hmacSha256(secret, payloadPart);
  if (!timingSafeEqual(expected, candidate)) {
    throw new ViewerTokenError("Invalid viewer token: signature mismatch");
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(new TextDecoder().decode(fromBase64url(payloadPart))) as Record<
      string,
      unknown
    >;
  } catch {
    throw new ViewerTokenError("Invalid viewer token: malformed payload");
  }
  if (typeof raw.tenant !== "string" || raw.tenant.length === 0) {
    throw new ViewerTokenError("Invalid viewer token: missing tenant");
  }
  if (typeof raw.exp !== "number" || !Number.isFinite(raw.exp)) {
    throw new ViewerTokenError("Invalid viewer token: missing expiry");
  }
  if (raw.links !== undefined && !isStringArray(raw.links)) {
    throw new ViewerTokenError("Invalid viewer token: malformed links");
  }
  if (raw.allow !== undefined && !isStringArray(raw.allow)) {
    throw new ViewerTokenError("Invalid viewer token: malformed allow");
  }
  if (Date.now() >= raw.exp) {
    throw new ViewerTokenError("Viewer token has expired");
  }
  return {
    tenant: raw.tenant,
    ...(raw.links ? { links: raw.links } : {}),
    ...(raw.allow ? { allow: raw.allow as LinksAction[] } : {}),
    exp: raw.exp,
  };
}
