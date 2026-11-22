/**
 * Ordered targeting rules (ADR 0011): each rule ANDs conditions and sends
 * matching visitors to a URL or a weighted A/B split. The model lives in
 * `lib/rules.ts`; this is the view.
 *
 * @module
 */

import * as React from "react";
import { ArrowDown, ArrowUp, CornerDownRight, Plus, Split, Trash2, X } from "lucide-react";
import type { Condition, LinkRule, QueryCondition, ValueCondition } from "../types.ts";
import {
  changeConditionField,
  FIELD_OPTIONS,
  fieldOption,
  moveItem,
  newCondition,
  newRule,
  nextVariantId,
  ruleTarget,
  setRuleTarget,
  validateRules,
  variantPercents,
  type RuleField,
} from "../lib/rules.ts";
import { fromLocalInput, toLocalInput } from "../lib/link-form.ts";
import { countryName, continentName, displayUrl, prettyValue } from "../lib/format.ts";
import { cn } from "@xtandard/kit/ui";
import { Button } from "@xtandard/kit/ui";
import { Dropdown, Segmented, TextInput } from "@xtandard/kit/ui";
import { TagInput } from "./TagInput.tsx";

const VARIANT_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-5)",
  "var(--chart-4)",
];

function valueFormatter(field: RuleField): ((v: string) => string) | undefined {
  if (field === "country") return (v) => `${v} · ${countryName(v)}`;
  if (field === "continent") return (v) => `${v} · ${continentName(v)}`;
  if (field === "device" || field === "os" || field === "browser") return prettyValue;
  return undefined;
}

function ConditionEditor({
  condition,
  onChange,
  onRemove,
  index,
  disabled,
}: {
  condition: Condition;
  onChange: (c: Condition) => void;
  onRemove: () => void;
  index: number;
  disabled?: boolean;
}) {
  const field = condition.field as RuleField;
  const opt = fieldOption(field);
  return (
    <div className="flex flex-wrap items-start gap-2" data-testid="rule-condition">
      <span className="mt-2 w-9 shrink-0 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {index === 0 ? "If" : "and"}
      </span>
      <Dropdown
        aria-label="Condition field"
        value={field}
        disabled={disabled}
        onValueChange={(v) => onChange(changeConditionField(condition, v as RuleField))}
        options={FIELD_OPTIONS.map((f) => ({ value: f.value, label: f.label }))}
        className="w-36"
      />
      {condition.field === "time" ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <TextInput
            type="datetime-local"
            aria-label="After"
            className="w-auto flex-1"
            value={toLocalInput(condition.after)}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...condition, after: fromLocalInput(e.target.value) ?? undefined })
            }
          />
          <span className="text-[12px] text-muted-foreground">to</span>
          <TextInput
            type="datetime-local"
            aria-label="Before"
            className="w-auto flex-1"
            value={toLocalInput(condition.before)}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...condition, before: fromLocalInput(e.target.value) ?? undefined })
            }
          />
        </div>
      ) : condition.field === "query" ? (
        <QueryEditor condition={condition} onChange={onChange} disabled={disabled} />
      ) : condition.field === "qr" ? (
        <Dropdown
          aria-label="QR scan"
          value={(condition.op === "in") === condition.values.includes("true") ? "yes" : "no"}
          disabled={disabled}
          onValueChange={(v) =>
            onChange({ field: "qr", op: "in", values: [v === "yes" ? "true" : "false"] })
          }
          options={[
            { value: "yes", label: "was scanned from a QR code" },
            { value: "no", label: "was not scanned" },
          ]}
          className="min-w-0 flex-1"
        />
      ) : (
        <>
          <Dropdown
            aria-label="Operator"
            value={(condition as ValueCondition).op}
            disabled={disabled}
            onValueChange={(v) =>
              onChange({ ...(condition as ValueCondition), op: v as "in" | "not_in" })
            }
            options={[
              { value: "in", label: "is" },
              { value: "not_in", label: "is not" },
            ]}
            className="w-24"
          />
          <TagInput
            aria-label={`${opt.label} values`}
            values={(condition as ValueCondition).values}
            onChange={(values) => onChange({ ...(condition as ValueCondition), values })}
            suggestions={opt.suggestions}
            uppercase={opt.upper}
            lowercase={!opt.upper}
            format={valueFormatter(field)}
            placeholder={opt.placeholder ?? "Type and press Enter…"}
            disabled={disabled}
            className="min-w-0 flex-1 basis-48"
          />
        </>
      )}
      {!disabled && (
        <button
          type="button"
          aria-label="Remove condition"
          onClick={onRemove}
          className="mt-1 rounded-md p-1.5 text-muted-foreground/70 hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

function QueryEditor({
  condition,
  onChange,
  disabled,
}: {
  condition: QueryCondition;
  onChange: (c: Condition) => void;
  disabled?: boolean;
}) {
  const needsValues = condition.op === "in" || condition.op === "not_in";
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-start gap-2">
      <TextInput
        aria-label="Query parameter"
        placeholder="ref"
        value={condition.key}
        disabled={disabled}
        onChange={(e) => onChange({ ...condition, key: e.target.value })}
        className="w-28 font-mono"
      />
      <Dropdown
        aria-label="Query operator"
        value={condition.op}
        disabled={disabled}
        onValueChange={(v) =>
          onChange({ ...condition, op: v as QueryCondition["op"], values: condition.values ?? [] })
        }
        options={[
          { value: "in", label: "is" },
          { value: "not_in", label: "is not" },
          { value: "exists", label: "is present" },
          { value: "missing", label: "is missing" },
        ]}
        className="w-32"
      />
      {needsValues && (
        <TagInput
          aria-label="Query values"
          values={condition.values ?? []}
          onChange={(values) => onChange({ ...condition, values })}
          placeholder="value"
          disabled={disabled}
          className="min-w-0 flex-1 basis-32"
        />
      )}
    </div>
  );
}

function RuleCard({
  rule,
  index,
  count,
  issues,
  onChange,
  onMove,
  onRemove,
  disabled,
}: {
  rule: LinkRule;
  index: number;
  count: number;
  issues: string[];
  onChange: (r: LinkRule) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const target = ruleTarget(rule);
  const percents = variantPercents(rule.variants ?? []);
  return (
    <div
      className={cn(
        "rounded-xl border bg-card",
        issues.length ? "border-destructive/40" : "border-border",
      )}
      data-testid="rule-card"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-accent/15 text-[11px] font-semibold tabular-nums text-accent">
          {index + 1}
        </span>
        <input
          aria-label={`Rule ${index + 1} name`}
          placeholder={`Rule ${index + 1}`}
          value={rule.name ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ ...rule, name: e.target.value })}
          className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1.5 text-[13px] font-medium outline-none placeholder:text-muted-foreground hover:bg-secondary/50 focus-visible:bg-secondary/50"
        />
        {!disabled && (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              aria-label="Move rule up"
              disabled={index === 0}
              onClick={() => onMove(index - 1)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30"
            >
              <ArrowUp className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Move rule down"
              disabled={index === count - 1}
              onClick={() => onMove(index + 1)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30"
            >
              <ArrowDown className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Delete rule"
              onClick={onRemove}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 px-3 py-3">
        {rule.when.length === 0 && (
          <p className="pl-11 text-[12.5px] text-muted-foreground">
            No conditions — matches every visitor (use it for a plain A/B test).
          </p>
        )}
        {rule.when.map((c, ci) => (
          <ConditionEditor
            key={ci}
            index={ci}
            condition={c}
            disabled={disabled}
            onChange={(next) =>
              onChange({ ...rule, when: rule.when.map((x, j) => (j === ci ? next : x)) })
            }
            onRemove={() => onChange({ ...rule, when: rule.when.filter((_, j) => j !== ci) })}
          />
        ))}
        {!disabled && (
          <div className="pl-11">
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus className="size-3.5" />}
              onClick={() =>
                onChange({
                  ...rule,
                  when: [...rule.when, newCondition(rule.when.length ? "device" : "country")],
                })
              }
            >
              Add condition
            </Button>
          </div>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-dashed border-border pt-3">
          <span className="flex w-9 shrink-0 justify-end text-muted-foreground">
            <CornerDownRight className="size-4" />
          </span>
          <Segmented
            size="sm"
            value={target}
            onValueChange={(t) => onChange(setRuleTarget(rule, t))}
            options={[
              { value: "url", label: "Redirect to" },
              {
                value: "variants",
                label: (
                  <>
                    <Split className="size-3" /> A/B split
                  </>
                ),
              },
            ]}
          />
          {target === "url" && (
            <TextInput
              aria-label={`Rule ${index + 1} destination`}
              placeholder="https://acme.com/de"
              value={rule.url ?? ""}
              disabled={disabled}
              onChange={(e) => onChange({ ...rule, url: e.target.value })}
              className="min-w-0 flex-1 basis-56"
            />
          )}
        </div>

        {target === "variants" && (
          <div className="flex flex-col gap-2 pl-11">
            <div className="flex h-2 overflow-hidden rounded-full bg-secondary" aria-hidden>
              {(rule.variants ?? []).map((v, vi) => (
                <span
                  key={vi}
                  style={{
                    width: `${percents[vi] ?? 0}%`,
                    background: VARIANT_COLORS[vi % VARIANT_COLORS.length],
                  }}
                />
              ))}
            </div>
            {(rule.variants ?? []).map((v, vi) => (
              <div key={vi} className="flex items-center gap-2" data-testid="rule-variant">
                <span
                  className="flex h-6 min-w-6 items-center justify-center rounded-md px-1 font-mono text-[11px] font-semibold text-background"
                  style={{ background: VARIANT_COLORS[vi % VARIANT_COLORS.length] }}
                >
                  {v.id ?? vi}
                </span>
                <TextInput
                  aria-label={`Variant ${v.id ?? vi} URL`}
                  placeholder="https://acme.com/landing-b"
                  value={v.url}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange({
                      ...rule,
                      variants: rule.variants!.map((x, j) =>
                        j === vi ? { ...x, url: e.target.value } : x,
                      ),
                    })
                  }
                  className="min-w-0 flex-1"
                />
                <div className="relative w-24 shrink-0">
                  <TextInput
                    type="number"
                    min={1}
                    aria-label={`Variant ${v.id ?? vi} weight`}
                    value={String(v.weight)}
                    disabled={disabled}
                    onChange={(e) =>
                      onChange({
                        ...rule,
                        variants: rule.variants!.map((x, j) =>
                          j === vi ? { ...x, weight: Number(e.target.value) } : x,
                        ),
                      })
                    }
                    className="pr-10 tabular-nums"
                  />
                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground">
                    {percents[vi] ?? 0}%
                  </span>
                </div>
                {!disabled && (rule.variants?.length ?? 0) > 2 && (
                  <button
                    type="button"
                    aria-label={`Remove variant ${v.id ?? vi}`}
                    onClick={() =>
                      onChange({ ...rule, variants: rule.variants!.filter((_, j) => j !== vi) })
                    }
                    className="rounded-md p-1.5 text-muted-foreground/70 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            ))}
            {!disabled && (
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Plus className="size-3.5" />}
                  onClick={() =>
                    onChange({
                      ...rule,
                      variants: [
                        ...(rule.variants ?? []),
                        { id: nextVariantId(rule.variants ?? []), url: "", weight: 50 },
                      ],
                    })
                  }
                >
                  Add variant
                </Button>
              </div>
            )}
            <p className="text-[11.5px] text-muted-foreground">
              Each visitor is assigned a variant deterministically, so they see the same one on
              every visit. Clicks record the variant id.
            </p>
          </div>
        )}

        {issues.length > 0 && (
          <ul className="ml-11 list-disc pl-4 text-[11.5px] text-destructive">
            {issues.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function RulesEditor({
  rules,
  onChange,
  defaultUrl,
  disabled,
  showIssues,
}: {
  rules: LinkRule[];
  onChange: (rules: LinkRule[]) => void;
  defaultUrl: string;
  disabled?: boolean;
  /** Show validation messages (after a save attempt). */
  showIssues?: boolean;
}) {
  const issues = showIssues ? validateRules(rules) : [];
  return (
    <div className="flex flex-col gap-3">
      {rules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
          <p className="text-[13px] text-muted-foreground">
            Send visitors to different places by country, device, language, referrer, QR scans,
            query string or time — or split traffic for an A/B test.
          </p>
          {!disabled && (
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Button
                size="sm"
                icon={<Plus className="size-3.5" />}
                onClick={() => onChange([newRule("country")])}
              >
                Geo rule
              </Button>
              <Button
                size="sm"
                icon={<Plus className="size-3.5" />}
                onClick={() => onChange([newRule("os")])}
              >
                Device rule
              </Button>
              <Button
                size="sm"
                icon={<Split className="size-3.5" />}
                onClick={() =>
                  onChange([setRuleTarget({ ...newRule(), url: defaultUrl }, "variants")])
                }
              >
                A/B test
              </Button>
            </div>
          )}
        </div>
      ) : (
        <>
          <p className="text-[12px] text-muted-foreground">
            Rules run top to bottom; the first match wins.
          </p>
          {rules.map((rule, i) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              index={i}
              count={rules.length}
              disabled={disabled}
              issues={issues.filter((x) => x.rule === i).map((x) => x.message)}
              onChange={(next) => onChange(rules.map((r, j) => (j === i ? next : r)))}
              onMove={(to) => onChange(moveItem(rules, i, to))}
              onRemove={() => onChange(rules.filter((_, j) => j !== i))}
            />
          ))}
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-[12.5px] text-muted-foreground">
            <span className="flex size-5 items-center justify-center rounded-md bg-secondary text-[11px] font-semibold">
              ∗
            </span>
            Otherwise →
            <span className="truncate font-mono text-[12px] text-foreground">
              {defaultUrl ? displayUrl(defaultUrl) : "the default destination"}
            </span>
          </div>
          {!disabled && (
            <div>
              <Button
                size="sm"
                icon={<Plus className="size-3.5" />}
                onClick={() => onChange([...rules, newRule("country")])}
              >
                Add rule
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
