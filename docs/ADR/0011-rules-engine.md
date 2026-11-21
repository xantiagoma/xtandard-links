# ADR 0011 — Rules Engine: Ordered Conditions, Deterministic Variants

**Status:** Accepted (★ new; simpler than flags' targeting on purpose)

---

## Context

Targeting by device / OS / country / language and A/B split tests are table stakes (Dub, Bitly,
Short.io, Shlink "redirect rules"). Flags has a full condition-tree evaluator, but redirects need a
small, fast, explainable subset.

## Decision

- `link.rules` is an ordered list; the **first rule whose conditions all match** wins; no match →
  `link.url`. Platform destinations (`ios` / `android`) and expiry are evaluated before rules.
- Condition = `{ field, op: "in" | "not_in", values }` over `device`, `os`, `browser`, `country`,
  `continent`, `language` (Accept-Language primary tags), `referrer` (host), `qr`, `query`
  (`{ field: "query", key, op, values }`), and `{ field: "time", after?, before? }`.
- A rule has either `url` or `variants: [{ url, weight }]`. Variant selection is deterministic per
  visitor: `fnv1a(visitorKey + linkId + ruleId) mod totalWeight`, where `visitorKey` is the daily
  visitor hash or, when privacy disables it, the click id (random per click).
- Rules are compiled once per cache entry (ADR 0002); evaluation is allocation-light.

## Consequences

- Predictable precedence the UI can explain ("Rule 2 matched: country in [DE, AT]").
- No nested boolean trees; complex logic belongs in the host (a `before` hook or a custom resolver).
