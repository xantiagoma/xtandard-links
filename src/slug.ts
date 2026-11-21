/**
 * Slug normalization, validation and generation (ADR 0012). Zero dependencies.
 *
 * @module
 */

/** Characters generated slugs use on case-insensitive domains (no look-alikes). */
export const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
/** Characters generated slugs use on case-sensitive domains. */
export const SLUG_ALPHABET_CASED = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
/** Default generated slug length. */
export const DEFAULT_SLUG_LENGTH = 7;
/** Maximum slug length. */
export const MAX_SLUG_LENGTH = 190;

/** Paths the redirect handler never treats as slugs. */
export const DEFAULT_RESERVED_SLUGS: readonly string[] = [
  ".well-known",
  "api",
  "_links",
  "favicon.ico",
  "robots.txt",
];

const SLUG_RE = /^[\p{L}\p{N}\-_.~]+(?:\/[\p{L}\p{N}\-_.~]+)*$/u;

/**
 * The lookup key for a slug: NFC-normalized, lowercased unless the domain is
 * case-sensitive.
 */
export function slugKey(slug: string, caseSensitive = false): string {
  const nfc = slug.normalize("NFC");
  return caseSensitive ? nfc : nfc.toLowerCase();
}

/** Why a slug is invalid, or `null` when it is valid. */
export function slugProblem(
  slug: string,
  reserved: readonly string[] = DEFAULT_RESERVED_SLUGS,
): string | null {
  if (slug.length === 0) return "must not be empty";
  if (slug.length > MAX_SLUG_LENGTH) return `must be at most ${MAX_SLUG_LENGTH} characters`;
  if (!SLUG_RE.test(slug)) {
    return "may contain letters, digits, - _ . ~ and / between segments";
  }
  if (slug.split("/").some((seg) => /^\.+$/.test(seg))) return "segments must not be only dots";
  const first = slugKey(slug.split("/")[0] as string);
  if (reserved.some((r) => r.toLowerCase() === first)) return `"${first}" is reserved`;
  return null;
}

/** Generate a random slug from the domain's alphabet (Web Crypto). */
export function generateSlug(length = DEFAULT_SLUG_LENGTH, caseSensitive = false): string {
  const alphabet = caseSensitive ? SLUG_ALPHABET_CASED : SLUG_ALPHABET;
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}
