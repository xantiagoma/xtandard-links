/**
 * Rules engine (ADR 0011): ordered rules, ANDed conditions, first match wins;
 * deterministic weighted variants. Pure and allocation-light — it runs on every
 * redirect.
 *
 * @module
 */

import type { Condition, LinkRule, Variant } from "./schema.ts";

/** What the rules engine knows about the visitor. All string values lowercase except `country`/`continent`. */
export interface VisitorContext {
  device: string;
  os: string;
  browser: string;
  /** ISO alpha-2, uppercase. */
  country?: string;
  /** Continent code, uppercase. */
  continent?: string;
  /** Primary language tags from Accept-Language, lowercase, in preference order (`["de", "en"]`). */
  languages: string[];
  /** Referrer hostname (lowercase) or `"(direct)"`. */
  referrerHost: string;
  qr: boolean;
  /** Query parameters of the short URL. */
  query: URLSearchParams;
  /** Evaluation time, epoch millis. */
  now: number;
}

/** The outcome of rule evaluation. */
export interface RuleMatch {
  url: string;
  ruleId?: string;
  variant?: string;
}

const lowerIncludes = (values: readonly string[], value: string | undefined): boolean => {
  if (value === undefined) return false;
  const v = value.toLowerCase();
  for (const x of values) if (x.toLowerCase() === v) return true;
  return false;
};

/** Evaluate one condition against the visitor. */
export function matchesCondition(condition: Condition, ctx: VisitorContext): boolean {
  switch (condition.field) {
    case "time": {
      if (condition.after && ctx.now < Date.parse(condition.after)) return false;
      if (condition.before && ctx.now >= Date.parse(condition.before)) return false;
      return true;
    }
    case "query": {
      const present = ctx.query.has(condition.key);
      if (condition.op === "exists") return present;
      if (condition.op === "missing") return !present;
      const value = ctx.query.get(condition.key) ?? undefined;
      const hit = lowerIncludes(condition.values ?? [], value);
      return condition.op === "in" ? hit : !hit;
    }
    default: {
      let hit: boolean;
      if (condition.field === "language") {
        hit = ctx.languages.some((l) => lowerIncludes(condition.values, l));
      } else if (condition.field === "qr") {
        hit = lowerIncludes(condition.values, ctx.qr ? "true" : "false");
      } else if (condition.field === "referrer") {
        // A value matches the referrer host or any parent domain (`google.com` ⊇ `www.google.com`).
        hit = condition.values.some((v) => {
          const want = v.toLowerCase();
          return ctx.referrerHost === want || ctx.referrerHost.endsWith(`.${want}`);
        });
      } else {
        hit = lowerIncludes(condition.values, ctx[condition.field]);
      }
      return condition.op === "in" ? hit : !hit;
    }
  }
}

/** FNV-1a 32-bit hash. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Pick a variant deterministically for `seed` (same seed → same variant).
 * Returns the variant and its id (explicit `id` or its index).
 */
export function pickVariant(
  variants: readonly Variant[],
  seed: string,
): { variant: Variant; id: string } | null {
  let total = 0;
  for (const v of variants) if (v.weight > 0) total += v.weight;
  if (total <= 0) return null;
  let point = (fnv1a(seed) / 0x1_0000_0000) * total;
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i] as Variant;
    if (v.weight <= 0) continue;
    if (point < v.weight) return { variant: v, id: v.id ?? String(i) };
    point -= v.weight;
  }
  const lastIndex = variants.findLastIndex((v) => v.weight > 0);
  const last = variants[lastIndex] as Variant;
  return { variant: last, id: last.id ?? String(lastIndex) };
}

/**
 * Evaluate a link's rules. Returns the first matching rule's destination (or
 * variant), or `null` when no rule matches.
 *
 * @param seed visitor-stable seed for variant selection (visitor hash + link id).
 */
export function evaluateRules(
  rules: readonly LinkRule[],
  ctx: VisitorContext,
  seed: string,
): RuleMatch | null {
  for (const rule of rules) {
    let ok = true;
    for (const c of rule.when) {
      if (!matchesCondition(c, ctx)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (rule.variants && rule.variants.length > 0) {
      const picked = pickVariant(rule.variants, `${seed}:${rule.id}`);
      if (picked) return { url: picked.variant.url, ruleId: rule.id, variant: picked.id };
    }
    if (rule.url) return { url: rule.url, ruleId: rule.id };
  }
  return null;
}

/** Parse Accept-Language into primary tags, by q-value, lowercase, de-duplicated. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  const entries = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.slice(2)) : 1, index };
    })
    .filter((e) => e.tag && e.tag !== "*" && !Number.isNaN(e.q) && e.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  const out: string[] = [];
  for (const e of entries) {
    const primary = e.tag.split("-")[0] as string;
    if (!out.includes(primary)) out.push(primary);
  }
  return out;
}
