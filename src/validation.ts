/**
 * Runtime validation for control-plane inputs, built on `valibot`.
 *
 * This is the **admin path** only — the redirect handler never imports this
 * module, so `valibot` stays off the hot path. Validation combines structural
 * parsing (valibot) with semantic checks (URL policy, slug rules).
 *
 * @module
 */

import {
  assertValid,
  issuesFrom as kitIssuesFrom,
  resultOf,
  validateKeySegment as kitValidateKeySegment,
  validateUrl,
  ValidationError,
  type ValidationIssue,
  type ValidationResult,
} from "@xtandard/kit/util";
import * as v from "valibot";
import { DEFAULT_RESERVED_SLUGS, slugProblem } from "./slug.ts";

export { assertValid, ValidationError, type ValidationIssue, type ValidationResult };

/** Allowed characters for tenant keys and external ids. */
export const KEY_REGEX = /^[a-zA-Z0-9._-]+$/;

/** Hostname: lowercase labels, optional port is not allowed. */
export const HOSTNAME_REGEX =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const result = resultOf;

/** Valibot issues of a failed parse, under `base` (see the kit's `issuesFrom`). */
const issuesFrom = (
  parsed: { success: boolean; issues?: readonly v.BaseIssue<unknown>[] },
  base: string,
): ValidationIssue[] =>
  parsed.success || !parsed.issues ? [] : kitIssuesFrom(parsed.issues, base);

/**
 * Validate a key segment (tenant key, external id): safe inside a storage key.
 * The kit's check: a non-empty string of at most 256 {@link KEY_REGEX}
 * characters, not only dots.
 */
export function validateKeySegment(value: unknown, path: string): ValidationIssue[] {
  return kitValidateKeySegment(value, path, { maxLength: 256 });
}

/** Options for destination URL policy. */
export interface UrlPolicyOptions {
  /** Allow non-http(s) schemes (app deep links like `myapp://`). Default `true`. */
  allowAppSchemes?: boolean;
  /** Extra check; return a message to reject. */
  urlPolicy?: (url: URL) => string | null | undefined;
}

/**
 * Validate a destination URL: an absolute URL of at most 8192 characters, never
 * `javascript:`, `data:`, `vbscript:`, `file:`, `blob:` or `about:` (the kit's
 * `validateUrl`), then the links policy.
 */
export function validateDestinationUrl(
  value: unknown,
  path: string,
  options: UrlPolicyOptions = {},
): ValidationIssue[] {
  return validateUrl(value, path, {
    policy: (url) => {
      const web = url.protocol === "http:" || url.protocol === "https:";
      if (!web && options.allowAppSchemes === false) return "must be an http(s) URL";
      return options.urlPolicy?.(url) || undefined;
    },
  });
}

const str = (max = 2048) => v.pipe(v.string(), v.maxLength(max));
const jsonObject = v.record(v.string(), v.unknown());

const utmSchema = v.strictObject({
  source: v.optional(str(256)),
  medium: v.optional(str(256)),
  campaign: v.optional(str(256)),
  term: v.optional(str(256)),
  content: v.optional(str(256)),
});

const conditionSchema = v.variant("field", [
  v.strictObject({
    field: v.picklist([
      "device",
      "os",
      "browser",
      "country",
      "continent",
      "language",
      "referrer",
      "qr",
    ]),
    op: v.picklist(["in", "not_in"]),
    values: v.pipe(v.array(str(256)), v.minLength(1), v.maxLength(500)),
  }),
  v.strictObject({
    field: v.literal("query"),
    key: v.pipe(str(256), v.minLength(1)),
    op: v.picklist(["in", "not_in", "exists", "missing"]),
    values: v.optional(v.pipe(v.array(str(1024)), v.maxLength(500))),
  }),
  v.strictObject({
    field: v.literal("time"),
    after: v.optional(v.pipe(v.string(), v.isoTimestamp())),
    before: v.optional(v.pipe(v.string(), v.isoTimestamp())),
  }),
]);

const ruleSchema = v.strictObject({
  id: v.optional(v.pipe(str(64), v.minLength(1))),
  name: v.optional(str(256)),
  when: v.pipe(v.array(conditionSchema), v.maxLength(20)),
  url: v.optional(v.string()),
  variants: v.optional(
    v.pipe(
      v.array(
        v.strictObject({
          id: v.optional(v.pipe(str(64), v.minLength(1))),
          url: v.string(),
          weight: v.pipe(v.number(), v.minValue(0), v.maxValue(1_000_000)),
        }),
      ),
      v.maxLength(20),
    ),
  ),
});

const isoDate = v.pipe(v.string(), v.isoTimestamp());

/** Structural schema shared by link create and update inputs. */
const linkFields = {
  tenant: v.optional(v.string()),
  domain: v.optional(v.string()),
  slug: v.optional(v.string()),
  url: v.optional(v.string()),
  title: v.optional(v.nullable(str(512))),
  description: v.optional(v.nullable(str(4096))),
  tags: v.optional(v.pipe(v.array(v.pipe(str(64), v.minLength(1))), v.maxLength(50))),
  externalId: v.optional(v.nullable(v.string())),
  expiresAt: v.optional(v.nullable(isoDate)),
  expiredUrl: v.optional(v.nullable(v.string())),
  maxClicks: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
  password: v.optional(v.nullable(v.pipe(v.string(), v.minLength(1), v.maxLength(256)))),
  utm: v.optional(v.nullable(utmSchema)),
  preview: v.optional(
    v.nullable(
      v.strictObject({
        title: v.optional(str(512)),
        description: v.optional(str(2048)),
        image: v.optional(str(2048)),
      }),
    ),
  ),
  rules: v.optional(v.pipe(v.array(ruleSchema), v.maxLength(50))),
  ios: v.optional(v.nullable(v.string())),
  android: v.optional(v.nullable(v.string())),
  deepLink: v.optional(
    v.nullable(
      v.strictObject({
        path: v.optional(str(2048)),
        deferred: v.optional(v.boolean()),
      }),
    ),
  ),
  redirectStatus: v.optional(v.nullable(v.picklist([301, 302, 307, 308]))),
  trackConversions: v.optional(v.boolean()),
  passQuery: v.optional(v.boolean()),
  indexable: v.optional(v.boolean()),
  disabled: v.optional(v.boolean()),
  archived: v.optional(v.boolean()),
  metadata: v.optional(v.nullable(jsonObject)),
};

const linkInputSchema = v.strictObject(linkFields);

/** Options for {@link validateLinkInput}. */
export interface LinkValidationOptions extends UrlPolicyOptions {
  /** `create` requires `url`; `update` validates only what is present. */
  mode: "create" | "update";
  reservedSlugs?: readonly string[];
}

/** Validate a link create/update input (structure + URLs + slug). */
export function validateLinkInput(
  input: unknown,
  options: LinkValidationOptions,
  base = "link",
): ValidationResult {
  const parsed = v.safeParse(linkInputSchema, input);
  const errors = issuesFrom(parsed, base);
  if (!parsed.success) return result(errors);
  const link = parsed.output;
  if (options.mode === "create" || link.url !== undefined) {
    errors.push(...validateDestinationUrl(link.url, `${base}.url`, options));
  }
  for (const field of ["expiredUrl", "ios", "android"] as const) {
    const value = link[field];
    if (value !== undefined && value !== null) {
      errors.push(...validateDestinationUrl(value, `${base}.${field}`, options));
    }
  }
  if (link.tenant !== undefined) errors.push(...validateKeySegment(link.tenant, `${base}.tenant`));
  if (link.externalId !== undefined && link.externalId !== null) {
    errors.push(...validateKeySegment(link.externalId, `${base}.externalId`));
  }
  if (link.domain !== undefined && !HOSTNAME_REGEX.test(link.domain.toLowerCase())) {
    errors.push({ path: `${base}.domain`, message: "must be a hostname (no scheme or port)" });
  }
  if (link.slug !== undefined) {
    const problem = slugProblem(link.slug, options.reservedSlugs ?? DEFAULT_RESERVED_SLUGS);
    if (problem) errors.push({ path: `${base}.slug`, message: problem });
  }
  if (link.preview?.image) {
    errors.push(
      ...validateDestinationUrl(link.preview.image, `${base}.preview.image`, {
        allowAppSchemes: false,
      }),
    );
  }
  for (const [i, rule] of (link.rules ?? []).entries()) {
    const path = `${base}.rules[${i}]`;
    const hasVariants = rule.variants !== undefined && rule.variants.length > 0;
    if (!rule.url && !hasVariants) {
      errors.push({ path, message: "needs a url or variants" });
    }
    if (rule.url) errors.push(...validateDestinationUrl(rule.url, `${path}.url`, options));
    for (const [j, variant] of (rule.variants ?? []).entries()) {
      errors.push(...validateDestinationUrl(variant.url, `${path}.variants[${j}].url`, options));
    }
    if (hasVariants && !(rule.variants ?? []).some((x) => x.weight > 0)) {
      errors.push({ path: `${path}.variants`, message: "at least one weight must be > 0" });
    }
  }
  return result(errors);
}

const domainSchema = v.strictObject({
  hostname: v.string(),
  tenant: v.optional(v.nullable(v.string())),
  rootUrl: v.optional(v.nullable(v.string())),
  notFoundUrl: v.optional(v.nullable(v.string())),
  caseSensitive: v.optional(v.boolean()),
  slugLength: v.optional(v.pipe(v.number(), v.integer(), v.minValue(3), v.maxValue(32))),
  isDefault: v.optional(v.boolean()),
  metadata: v.optional(v.nullable(jsonObject)),
  apps: v.optional(
    v.nullable(
      v.strictObject({
        ios: v.optional(
          v.strictObject({
            appIds: v.pipe(
              v.array(v.pipe(v.string(), v.regex(/^[A-Z0-9]{10}\.[\w.-]+$/))),
              v.minLength(1),
            ),
            paths: v.optional(v.array(str(512))),
          }),
        ),
        android: v.optional(
          v.array(
            v.strictObject({
              packageName: v.pipe(v.string(), v.regex(/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/)),
              sha256CertFingerprints: v.pipe(
                v.array(v.pipe(v.string(), v.regex(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/i))),
                v.minLength(1),
              ),
            }),
          ),
        ),
      }),
    ),
  ),
});

/** Validate a domain input. With `partial`, `hostname` may be omitted (update). */
export function validateDomainInput(
  input: unknown,
  base = "domain",
  partial = false,
): ValidationResult {
  const schema = partial
    ? v.strictObject({ ...domainSchema.entries, hostname: v.optional(v.string()) })
    : domainSchema;
  const parsed = v.safeParse(schema, input);
  const errors = issuesFrom(parsed, base);
  if (!parsed.success) return result(errors);
  const d = parsed.output;
  if (d.hostname !== undefined && !HOSTNAME_REGEX.test(d.hostname.toLowerCase())) {
    errors.push({ path: `${base}.hostname`, message: "must be a hostname (no scheme or port)" });
  }
  if (d.tenant) errors.push(...validateKeySegment(d.tenant, `${base}.tenant`));
  for (const field of ["rootUrl", "notFoundUrl"] as const) {
    const value = d[field];
    if (value) errors.push(...validateDestinationUrl(value, `${base}.${field}`));
  }
  return result(errors);
}

const tenantSchema = v.strictObject({
  key: v.string(),
  name: v.optional(str(256)),
  metadata: v.optional(jsonObject),
});

/** Validate a tenant input. */
export function validateTenantInput(input: unknown, base = "tenant"): ValidationResult {
  const parsed = v.safeParse(tenantSchema, input);
  const errors = issuesFrom(parsed, base);
  if (parsed.success) errors.push(...validateKeySegment(parsed.output.key, `${base}.key`));
  return result(errors);
}
