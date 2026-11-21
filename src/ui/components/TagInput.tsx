import React, { useId, useState } from "react";
import { X } from "lucide-react";
import { cn } from "../lib/utils.ts";

/**
 * Edit a list of free-form values as chips. Enter, comma or Tab adds;
 * Backspace on an empty input removes the last chip. `suggestions` feed a
 * native datalist (existing tags, country codes, …).
 */
export function TagInput({
  values,
  onChange,
  placeholder = "Add…",
  disabled,
  lowercase = false,
  uppercase = false,
  suggestions,
  format,
  "aria-label": ariaLabel,
  className,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  lowercase?: boolean;
  uppercase?: boolean;
  suggestions?: string[];
  /** Display label for a chip value (e.g. country code → name). */
  format?: (value: string) => string;
  "aria-label"?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState("");
  const listId = useId();

  const add = (raw: string) => {
    const parts = raw.split(",");
    let next = values;
    for (const part of parts) {
      const trimmed = part.trim();
      const t = uppercase ? trimmed.toUpperCase() : lowercase ? trimmed.toLowerCase() : trimmed;
      if (t && !next.includes(t)) next = [...next, t];
    }
    if (next !== values) onChange(next);
    setDraft("");
  };

  const remaining = suggestions?.filter((s) => !values.includes(s));

  return (
    <div
      className={cn(
        "flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-secondary/40 px-1.5 py-1 transition-colors",
        "focus-within:border-ring focus-within:ring-2 focus-within:ring-ring",
        disabled && "opacity-60",
        className,
      )}
    >
      {values.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 rounded-[5px] border border-border bg-card px-1.5 py-0.5 text-[12px] text-foreground"
        >
          {format ? format(t) : t}
          {!disabled && (
            <button
              type="button"
              aria-label={`Remove ${t}`}
              onClick={() => onChange(values.filter((v) => v !== t))}
              className="text-muted-foreground/70 hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <>
          <input
            value={draft}
            aria-label={ariaLabel}
            placeholder={values.length ? "" : placeholder}
            list={remaining?.length ? listId : undefined}
            onChange={(e) => {
              const v = e.target.value;
              // Picking a datalist option fires a plain change with the full value.
              if (remaining?.includes(v)) add(v);
              else setDraft(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "," || (e.key === "Tab" && draft.trim())) {
                e.preventDefault();
                add(draft);
              } else if (e.key === "Backspace" && !draft && values.length) {
                onChange(values.slice(0, -1));
              }
            }}
            onBlur={() => draft && add(draft)}
            className="h-6 min-w-24 flex-1 bg-transparent px-1 text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          {remaining?.length ? (
            <datalist id={listId}>
              {remaining.map((s) => (
                <option key={s} value={s}>
                  {format ? format(s) : s}
                </option>
              ))}
            </datalist>
          ) : null}
        </>
      )}
    </div>
  );
}
