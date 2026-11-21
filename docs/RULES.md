# Targeting rules

Send visitors to different destinations by device, OS, browser, country, language, referrer, QR
scan, query parameter or time window, and split traffic across weighted A/B variants. Small, fast
and explainable on purpose (ADR [0011](ADR/0011-rules-engine.md)).

## How a destination is chosen

1. iOS visitors go to `link.ios` and Android visitors to `link.android`, when set (store listings,
   see [Deep links](DEEP_LINKS.md)). Rules are not evaluated for them.
2. Otherwise `link.rules` is walked **in order**; the **first rule whose conditions all match**
   wins.
3. No match: `link.url`.

Expiry, `disabled` and the password gate run before any of this ([Architecture](ARCHITECTURE.md)).
UTM merge, query pass-through and the click id are applied to whichever URL was chosen.

```ts
await core.createLink({
  slug: "app",
  url: "https://acme.com/download", // the fallback
  rules: [
    {
      name: "DACH",
      when: [{ field: "country", op: "in", values: ["DE", "AT", "CH"] }],
      url: "https://acme.de/download",
    },
    {
      name: "Desktop landing test",
      when: [{ field: "device", op: "in", values: ["desktop"] }],
      variants: [
        { id: "a", url: "https://acme.com/download?v=a", weight: 50 },
        { id: "b", url: "https://acme.com/download?v=b", weight: 50 },
      ],
    },
  ],
});
```

A German desktop visitor matches rule 1 and never reaches the test. Rule ids are generated
(`r_…`) when you omit them; the matched rule's `id` and the chosen variant's id are recorded on the
click (`ruleId`, `variant`), so `groupBy: "variant"` compares the arms of a test.

## Conditions

A rule's `when` is a list of conditions, **ANDed**. An empty list always matches (a pure A/B
split, or a catch-all). Three shapes:

```ts
{ field: "country", op: "in", values: ["DE", "AT"] }           // value conditions
{ field: "query", key: "plan", op: "in", values: ["pro"] }      // query parameters
{ field: "time", after: "2026-11-27T00:00:00Z", before: "2026-12-01T00:00:00Z" }
```

| Field       | Matches                                                | Values                                                                                                                                       |
| ----------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `device`    | device class from the user agent                       | `desktop`, `mobile`, `tablet`, `tv`, `console`, `bot`, `unknown`                                                                             |
| `os`        | OS family                                              | `ios`, `android`, `windows`, `macos`, `linux`, `chromeos`, `windows-phone`, `console`, `tv`, `unknown`                                       |
| `browser`   | browser family                                         | `chrome`, `safari`, `firefox`, `edge`, `opera`, `samsung`, `yandex`, `vivaldi`, `brave`, `uc`, `facebook`, `line`, `wechat`, `ie`, `unknown` |
| `country`   | ISO 3166-1 alpha-2 from geo                            | `US`, `DE`, …                                                                                                                                |
| `continent` | continent code (from geo, or derived from the country) | `AF`, `AN`, `AS`, `EU`, `NA`, `OC`, `SA`                                                                                                     |
| `language`  | **any** primary tag in `Accept-Language` (q > 0)       | `en`, `de`, `pt`, … (region subtags are dropped: `pt-BR` reads `pt`)                                                                         |
| `referrer`  | referrer host, **or any parent domain**                | `google.com` matches `www.google.com`; `(direct)` matches no referrer                                                                        |
| `qr`        | the click came from a generated QR code (`?qr=1`)      | `"true"` / `"false"`                                                                                                                         |
| `query`     | a parameter of the short URL                           | `op: "in" \| "not_in"` with `values`, or `op: "exists" \| "missing"`                                                                         |
| `time`      | request time in `[after, before)`                      | ISO-8601 bounds, either optional                                                                                                             |

Value comparisons are case-insensitive. `op: "not_in"` matches when the value is absent too: a
visitor without a known country matches `country not_in ["DE"]`. Device, OS and browser come from
the built-in parser unless you pass your own `parseUserAgent`; country and continent from the geo
resolver ([Analytics](ANALYTICS.md)). Without geo headers, `country in […]` never matches.

The referrer is the `Referer` header, falling back to a `?ref=` parameter on the short URL (useful
where apps strip the header).

## A/B variants

A rule has either `url` or `variants: [{ id?, url, weight }]` (when both are set, variants win).
Weights are relative (`[1, 1]` is the same split as `[50, 50]`); a weight of `0` turns an arm off;
at least one must be positive.

Selection is **deterministic per visitor**: FNV-1a over `visitorKey:linkId:ruleId` picks the arm,
where `visitorKey` is the daily visitor hash. So the same visitor gets the same arm on every click
that day, and different links or rules split independently. Consequences:

- The visitor hash is `SHA-256(daily salt, tenant, IP, user agent)` ([Analytics](ANALYTICS.md)).
  It rotates at UTC midnight, so stickiness lasts a day.
- With several redirect processes, set the same `privacy.salt` secret on all of them: the default
  salt is random per process, which would make a visitor's arm depend on the process that served
  them.
- With `privacy.visitor: "none"`, or when the IP is unknown, the key is the click id: each click
  is an independent draw.

Variant ids default to the arm's index (`"0"`, `"1"`); give them names you will recognise in
analytics.

## Recipes

```ts
// Send QR scans of a printed poster to a mobile-optimised page.
{ when: [{ field: "qr", op: "in", values: ["true"] }], url: "https://acme.com/poster" }

// Spanish speakers, wherever they are.
{ when: [{ field: "language", op: "in", values: ["es"] }], url: "https://acme.com/es" }

// A launch-day page for one day only.
{
  when: [{ field: "time", after: "2026-12-01T09:00:00Z", before: "2026-12-02T09:00:00Z" }],
  url: "https://acme.com/launch",
}

// Visitors from your newsletter platform skip the landing page.
{ when: [{ field: "referrer", op: "in", values: ["substack.com"] }], url: "https://acme.com/signup" }

// Partners pass ?partner=…; everyone else gets the default.
{ when: [{ field: "query", key: "partner", op: "exists" }], url: "https://acme.com/partners" }

// Desktop Chrome in the EU (conditions AND).
{
  when: [
    { field: "device", op: "in", values: ["desktop"] },
    { field: "browser", op: "in", values: ["chrome"] },
    { field: "continent", op: "in", values: ["EU"] },
  ],
  url: "https://acme.com/eu-desktop",
}
```

## Limits and non-goals

- Up to 50 rules per link, 20 conditions per rule, 20 variants per rule, 500 values per condition.
- No nested boolean trees (`OR` is a second rule with the same URL). Logic that needs more belongs
  in your app: a `before` hook that rewrites rules on save, or a redirect to a route you own.
- Rules are pure and cheap: evaluated on the cached link record, no I/O. A throwing rule (it
  should not happen) is reported to `onError` and the visitor gets `link.url`.

The evaluator is exported for tests and previews: `evaluateRules(rules, visitorContext, seed)`,
`matchesCondition`, `pickVariant` and `parseAcceptLanguage` from `@xtandard/links`.
