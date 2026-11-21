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
 * to the HMAC as raw UTF-8 bytes. The mechanics are `@xtandard/kit/tokens`;
 * the `lvt_` prefix, the 1-day default lifetime and the `{ tenant, links?,
 * allow? }` claims are the links contract. An empty secret is rejected, and
 * `verifyViewerToken` accepts a list of secrets for rotation (the first signs,
 * any verifies). Revoking tokens before they expire means rotating the secret
 * without keeping the old one.
 *
 * @module
 */

import { LINKS_ACTIONS, type LinksAction } from "./authorization/contract.ts";
import { createScopedTokens, type TokenSecret } from "@xtandard/kit/tokens";
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
export const VIEWER_GRANTABLE_ACTIONS: readonly LinksAction[] = LINKS_ACTIONS.PORTAL_ACTIONS;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

/** The viewer token mechanics: `lvt_` prefix, 1-day default lifetime, links claims. */
const viewerTokens = createScopedTokens<Omit<ViewerTokenClaims, "exp">>({
  prefix: VIEWER_TOKEN_PREFIX,
  ttl: DEFAULT_VIEWER_TOKEN_EXPIRES_IN,
  label: "viewer token",
  errorName: "ViewerTokenError",
  // Read the clock at call time, so a mocked `Date` (fake timers) is honoured.
  now: () => Date.now(),
  validateClaims: (raw) => {
    if (typeof raw.tenant !== "string" || raw.tenant.length === 0) {
      throw new Error("missing tenant");
    }
    if (raw.links !== undefined && !isStringArray(raw.links)) throw new Error("malformed links");
    if (raw.allow !== undefined && !isStringArray(raw.allow)) throw new Error("malformed allow");
    return {
      tenant: raw.tenant,
      ...(raw.links ? { links: raw.links } : {}),
      ...(raw.allow ? { allow: raw.allow as LinksAction[] } : {}),
    };
  },
});

/**
 * Thrown by {@link verifyViewerToken} for any invalid token — malformed, bad
 * signature, or expired — and by {@link createViewerToken} for invalid input.
 * Maps to HTTP 401 at the API layer.
 */
export const ViewerTokenError = viewerTokens.TokenError;
/** An invalid viewer token (see the {@link ViewerTokenError} class). */
export type ViewerTokenError = InstanceType<typeof ViewerTokenError>;

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
  secret: TokenSecret,
  options: ViewerTokenOptions,
): Promise<string> {
  if (secret.length === 0) throw new ViewerTokenError("A viewer token secret is required");
  if (typeof options.tenant !== "string" || options.tenant.length === 0) {
    throw new ViewerTokenError("A viewer token needs a tenant");
  }
  const claims = {
    tenant: options.tenant,
    ...(options.links ? { links: [...options.links] } : {}),
    ...(options.allow ? { allow: [...options.allow] } : {}),
  };
  return viewerTokens.create(secret, claims, {
    expiresIn: options.expiresIn ?? DEFAULT_VIEWER_TOKEN_EXPIRES_IN,
  });
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
export async function verifyViewerToken(
  secret: TokenSecret,
  token: string,
): Promise<ViewerTokenClaims> {
  const { claims, expiresAt } = await viewerTokens.verify(secret, token);
  return { ...claims, exp: expiresAt };
}
