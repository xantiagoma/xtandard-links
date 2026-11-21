/**
 * Rule-editor model (ADR 0011): ordered rules, ANDed conditions, a single URL
 * or weighted A/B variants per rule. Pure helpers over the schema types so the
 * React editor stays a thin view — unit-tested in `test/ui-lib.test.ts`.
 *
 * @module
 */

import type {
  Condition,
  ConditionField,
  LinkRule,
  QueryCondition,
  TimeCondition,
  ValueCondition,
  Variant,
} from "../../schema.ts";
import { countryName, continentName, prettyValue } from "./format.ts";

/** Every field a condition can test, in menu order. */
export type RuleField = ConditionField | "query" | "time";

export interface FieldOption {
  value: RuleField;
  label: string;
  /** Suggested values (pick-list); free text is always allowed. */
  suggestions?: string[];
  /** Placeholder for the value input. */
  placeholder?: string;
  /** Values are uppercase codes (country/continent) rather than lowercase families. */
  upper?: boolean;
}

export const FIELD_OPTIONS: FieldOption[] = [
  {
    value: "device",
    label: "Device",
    suggestions: ["mobile", "desktop", "tablet", "tv", "console"],
  },
  {
    value: "os",
    label: "OS",
    suggestions: ["ios", "android", "windows", "macos", "linux", "chromeos"],
  },
  {
    value: "browser",
    label: "Browser",
    suggestions: ["chrome", "safari", "firefox", "edge", "samsung", "opera"],
  },
  {
    value: "country",
    label: "Country",
    placeholder: "US, DE, BR…",
    upper: true,
    suggestions: ["US", "GB", "DE", "FR", "ES", "BR", "IN", "JP", "CA", "AU", "MX", "NL"],
  },
  {
    value: "continent",
    label: "Continent",
    upper: true,
    suggestions: ["NA", "SA", "EU", "AF", "AS", "OC"],
  },
  { value: "language", label: "Language", placeholder: "en, de, pt…" },
  { value: "referrer", label: "Referrer", placeholder: "twitter.com, linkedin.com…" },
  { value: "qr", label: "QR scan" },
  { value: "query", label: "Query param" },
  { value: "time", label: "Time window" },
];

export function fieldOption(field: RuleField): FieldOption {
  return FIELD_OPTIONS.find((f) => f.value === field) ?? FIELD_OPTIONS[0]!;
}

/** Prefix for client-side ids of rules not yet saved (stripped before sending). */
export const DRAFT_ID_PREFIX = "draft_";

let counter = 0;
/** A unique client-side id for a new rule. */
export function draftId(): string {
  counter += 1;
  return `${DRAFT_ID_PREFIX}${Date.now().toString(36)}${counter.toString(36)}`;
}

/** A blank condition for `field`. */
export function newCondition(field: RuleField = "country"): Condition {
  switch (field) {
    case "query":
      return { field: "query", key: "", op: "in", values: [] };
    case "time":
      return { field: "time" };
    case "qr":
      return { field: "qr", op: "in", values: ["true"] };
    default:
      return { field, op: "in", values: [] };
  }
}

/** Switch a condition to another field, keeping the operator/values when compatible. */
export function changeConditionField(cond: Condition, field: RuleField): Condition {
  if (cond.field === field) return cond;
  const next = newCondition(field);
  if (isValueCondition(cond) && isValueCondition(next) && field !== "qr") {
    return { ...next, op: cond.op };
  }
  return next;
}

export function isValueCondition(c: Condition): c is ValueCondition {
  return c.field !== "query" && c.field !== "time";
}

/** A new rule matching visitors from nowhere yet, redirecting to an empty URL. */
export function newRule(field?: RuleField): LinkRule {
  return { id: draftId(), when: field ? [newCondition(field)] : [], url: "" };
}

export type RuleTarget = "url" | "variants";

export function ruleTarget(rule: LinkRule): RuleTarget {
  return rule.variants && rule.variants.length > 0 ? "variants" : "url";
}

/**
 * Switch a rule between a single destination and A/B variants. Going to
 * variants seeds two 50/50 variants from the current URL; going back keeps the
 * first variant's URL.
 */
export function setRuleTarget(rule: LinkRule, target: RuleTarget): LinkRule {
  if (ruleTarget(rule) === target) return rule;
  if (target === "variants") {
    const { url, ...rest } = rule;
    return {
      ...rest,
      variants: [
        { id: "a", url: url ?? "", weight: 50 },
        { id: "b", url: "", weight: 50 },
      ],
    };
  }
  const { variants, ...rest } = rule;
  return { ...rest, url: variants?.[0]?.url ?? "" };
}

/** Next free single-letter-ish variant id (`a`, `b`, … `z`, `v27`, …). */
export function nextVariantId(variants: readonly Variant[]): string {
  const used = new Set(variants.map((v) => v.id));
  for (let i = 0; i < 26; i++) {
    const id = String.fromCharCode(97 + i);
    if (!used.has(id)) return id;
  }
  let n = variants.length + 1;
  while (used.has(`v${n}`)) n++;
  return `v${n}`;
}

/** Integer percentages for variant weights, summing to exactly 100 (largest remainder). */
export function variantPercents(variants: readonly Pick<Variant, "weight">[]): number[] {
  const weights = variants.map((v) => (Number.isFinite(v.weight) && v.weight > 0 ? v.weight : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w / total) * 100);
  const floors = exact.map(Math.floor);
  let remainder = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i]! += 1;
    remainder -= 1;
  }
  return floors;
}

/** Move an item within a list (rules are ordered: first match wins). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return [...list];
  }
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** Split a comma/whitespace separated list into trimmed unique values. */
export function splitValues(raw: string, upper = false): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const v = upper ? part.trim().toUpperCase() : part.trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

const isValidUrl = (url: string): boolean => {
  try {
    const u = new URL(url);
    return (
      u.protocol === "http:" || u.protocol === "https:" || /^[a-z][a-z0-9+.-]*:$/i.test(u.protocol)
    );
  } catch {
    return false;
  }
};

/** A validation problem in the rules list. */
export interface RuleIssue {
  rule: number;
  message: string;
}

/** Client-side checks mirroring the server's validation (it stays authoritative). */
export function validateRules(rules: readonly LinkRule[]): RuleIssue[] {
  const issues: RuleIssue[] = [];
  rules.forEach((rule, i) => {
    for (const c of rule.when) {
      if (c.field === "query") {
        if (!c.key.trim())
          issues.push({ rule: i, message: "Query condition needs a parameter name" });
        if ((c.op === "in" || c.op === "not_in") && !(c.values ?? []).length) {
          issues.push({ rule: i, message: `Query "${c.key || "?"}" needs at least one value` });
        }
      } else if (c.field === "time") {
        if (!c.after && !c.before)
          issues.push({ rule: i, message: "Time window needs a start or an end" });
        if (c.after && c.before && Date.parse(c.after) >= Date.parse(c.before)) {
          issues.push({ rule: i, message: "Time window ends before it starts" });
        }
      } else if (!c.values.length) {
        issues.push({ rule: i, message: `${fieldOption(c.field).label} condition needs a value` });
      }
    }
    if (ruleTarget(rule) === "variants") {
      const variants = rule.variants ?? [];
      if (variants.length < 2) issues.push({ rule: i, message: "A/B split needs two variants" });
      if (variants.some((v) => !isValidUrl(v.url))) {
        issues.push({ rule: i, message: "Every variant needs a valid URL" });
      }
      if (variants.some((v) => !(v.weight > 0))) {
        issues.push({ rule: i, message: "Variant weights must be positive" });
      }
    } else if (!isValidUrl(rule.url ?? "")) {
      issues.push({ rule: i, message: "Destination must be a valid URL" });
    }
  });
  return issues;
}

/** Rules as API input: draft ids dropped (the server generates them), empty bits stripped. */
export function rulesToInput(
  rules: readonly LinkRule[],
): (Omit<LinkRule, "id"> & { id?: string })[] {
  return rules.map((rule) => {
    const out: Omit<LinkRule, "id"> & { id?: string } = { when: rule.when.map(cleanCondition) };
    if (!rule.id.startsWith(DRAFT_ID_PREFIX)) out.id = rule.id;
    if (rule.name?.trim()) out.name = rule.name.trim();
    if (ruleTarget(rule) === "variants") {
      out.variants = (rule.variants ?? []).map((v) => ({
        ...(v.id ? { id: v.id } : {}),
        url: v.url.trim(),
        weight: v.weight,
      }));
    } else out.url = (rule.url ?? "").trim();
    return out;
  });
}

function cleanCondition(c: Condition): Condition {
  if (c.field === "time") {
    const out: TimeCondition = { field: "time" };
    if (c.after) out.after = c.after;
    if (c.before) out.before = c.before;
    return out;
  }
  if (c.field === "query") {
    const out: QueryCondition = { field: "query", key: c.key.trim(), op: c.op };
    if (c.op === "in" || c.op === "not_in") out.values = c.values ?? [];
    return out;
  }
  return c;
}

function valueLabel(field: ConditionField, value: string): string {
  switch (field) {
    case "country":
      return countryName(value);
    case "continent":
      return continentName(value);
    case "device":
    case "os":
    case "browser":
      return prettyValue(value);
    default:
      return value;
  }
}

function listPhrase(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? "…";
  if (values.length === 2) return `${values[0]} or ${values[1]}`;
  return `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`;
}

/** One-line summary of a condition (`Country is Germany or France`). */
export function describeCondition(c: Condition): string {
  if (c.field === "time") {
    const fmt = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace("T", " ");
    if (c.after && c.before) return `Between ${fmt(c.after)} and ${fmt(c.before)} UTC`;
    if (c.after) return `After ${fmt(c.after)} UTC`;
    if (c.before) return `Before ${fmt(c.before)} UTC`;
    return "Any time";
  }
  if (c.field === "query") {
    const key = c.key || "?";
    if (c.op === "exists") return `?${key} is present`;
    if (c.op === "missing") return `?${key} is missing`;
    return `?${key} ${c.op === "in" ? "is" : "is not"} ${listPhrase(c.values ?? [])}`;
  }
  if (c.field === "qr") {
    const scanned = c.values.includes("true");
    const yes = c.op === "in" ? scanned : !scanned;
    return yes ? "Scanned from a QR code" : "Not from a QR code";
  }
  const label = fieldOption(c.field).label;
  const values = c.values.map((v) => valueLabel(c.field as ConditionField, v));
  return `${label} ${c.op === "in" ? "is" : "is not"} ${listPhrase(values)}`;
}

/** One-line summary of a rule (`If Country is Germany → acme.de` / `→ A/B 50/50`). */
export function describeRule(rule: LinkRule): string {
  const when = rule.when.length ? rule.when.map(describeCondition).join(" and ") : "Always";
  if (ruleTarget(rule) === "variants") {
    return `${when} → A/B ${variantPercents(rule.variants ?? []).join("/")}`;
  }
  return `${when} → ${rule.url || "…"}`;
}
