/**
 * Pure helpers behind the admin UI: formatters, chart scaling, analytics view
 * model (ranges, capability-aware filtering), the rule-editor model and the
 * link form mapping. Visual behavior is covered by the Playwright e2e suite.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import {
  bucketLabel,
  continentName,
  countryName,
  dimensionValueLabel,
  displayUrl,
  flagEmoji,
  formatCompact,
  formatCount,
  formatDateTime,
  formatMoney,
  formatPercent,
  hostOf,
  initials,
  percentChange,
  prettyValue,
  relativeTime,
  shortUrl,
  truncate,
} from "../src/ui/lib/format.ts";
import {
  areaPath,
  barPercents,
  labelIndices,
  linePath,
  nearestIndex,
  niceScale,
  projectPoints,
  smoothPath,
} from "../src/ui/lib/chart.ts";
import {
  availableMetrics,
  canQuery,
  conversionRate,
  decodeFilters,
  defaultInterval,
  encodeFilters,
  intervalsFor,
  metricValue,
  previousRange,
  rangeFor,
  toggleFilter,
} from "../src/ui/lib/analytics.ts";
import {
  changeConditionField,
  describeCondition,
  describeRule,
  DRAFT_ID_PREFIX,
  moveItem,
  newCondition,
  newRule,
  nextVariantId,
  ruleTarget,
  rulesToInput,
  setRuleTarget,
  splitValues,
  validateRules,
  variantPercents,
} from "../src/ui/lib/rules.ts";
import {
  applyUtm,
  draftFromLink,
  draftToCreateInput,
  draftToPatch,
  extractUtm,
  fromLocalInput,
  isDirty,
  slugIssue,
  toLocalInput,
} from "../src/ui/lib/link-form.ts";
import { canPerform } from "../src/ui/lib/shell.tsx";
import { analyticsQueryString, toQuery } from "../src/ui/api.ts";
import { errorMessage, LinksApiError, type PublicLink } from "../src/ui/types.ts";
import { ANALYTICS_DIMENSIONS } from "../src/analytics/contract.ts";

const link = (over: Partial<PublicLink> = {}): PublicLink => ({
  id: "lnk_1",
  tenant: "acme",
  domain: "go.acme.com",
  slug: "spring",
  url: "https://acme.com/sale",
  tags: ["sale"],
  rules: [],
  hasPassword: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

/* ─── format ────────────────────────────────────────────────────────────────── */

describe("format", () => {
  it("formats dates and handles bad input", () => {
    expect(formatDateTime("2026-01-02T03:04:05.000Z")).toContain("2026");
    expect(formatDateTime(undefined)).toBe("—");
    expect(formatDateTime("nope")).toBe("—");
  });

  it("formats relative times in both directions", () => {
    const now = Date.parse("2026-07-04T12:00:00.000Z");
    expect(relativeTime("2026-07-04T11:59:55.000Z", now)).toBe("just now");
    expect(relativeTime("2026-07-04T11:55:00.000Z", now)).toBe("5m ago");
    expect(relativeTime("2026-07-01T12:00:00.000Z", now)).toBe("3d ago");
    expect(relativeTime("2026-07-14T12:00:00.000Z", now)).toBe("in 10d");
    expect(relativeTime("2026-03-01T12:00:00.000Z", now)).toBe("4mo ago");
    expect(relativeTime(null, now)).toBe("—");
  });

  it("formats counts, compact numbers, money and percents", () => {
    expect(formatCount(12345)).toBe("12,345");
    expect(formatCount(undefined)).toBe("—");
    expect(formatCompact(950)).toBe("950");
    expect(formatCompact(1234)).toBe("1.2K");
    expect(formatCompact(34_000)).toBe("34K");
    expect(formatCompact(1_500_000)).toBe("1.5M");
    expect(formatMoney(12345, "USD")).toBe("$123.45");
    expect(formatMoney(5000, "JPY")).toBe("¥5,000");
    expect(formatMoney(100, "NOPE")).toBe("$1.00");
    expect(formatPercent(1, 40)).toBe("2.5%");
    expect(formatPercent(1, 8)).toBe("13%");
    expect(formatPercent(50, 100)).toBe("50%");
    expect(formatPercent(1, 10_000)).toBe("<0.1%");
    expect(formatPercent(1, 0)).toBe("—");
  });

  it("computes period-over-period change", () => {
    expect(percentChange(120, 100)).toBe(20);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(0, 0)).toBe(0);
  });

  it("builds and displays URLs", () => {
    expect(shortUrl({ domain: "go.acme.com", slug: "p/42" })).toBe("https://go.acme.com/p/42");
    expect(displayUrl("https://acme.com/pricing/")).toBe("acme.com/pricing");
    expect(hostOf("https://www.acme.com/x")).toBe("acme.com");
    expect(hostOf("acme://open")).toBe("open");
    expect(hostOf("not a url")).toBe("not a url");
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("abc", 4)).toBe("abc");
  });

  it("labels countries, continents and families", () => {
    expect(countryName("DE")).toBe("Germany");
    expect(countryName("(none)")).toBe("(none)");
    expect(flagEmoji("us")).toBe("🇺🇸");
    expect(flagEmoji("(none)")).toBe("");
    expect(continentName("EU")).toBe("Europe");
    expect(prettyValue("ios")).toBe("iOS");
    expect(prettyValue("chrome")).toBe("Chrome");
    expect(dimensionValueLabel("referrer", "(direct)")).toBe("Direct");
    expect(dimensionValueLabel("qr", "true")).toBe("QR scan");
    expect(dimensionValueLabel("utm_source", "(none)")).toBe("(not set)");
    expect(dimensionValueLabel("country", "(none)")).toBe("Unknown");
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("ada@x.io")).toBe("A");
    expect(initials(undefined)).toBe("?");
  });

  it("labels timeseries buckets", () => {
    expect(bucketLabel("2026-03-04T00:00:00.000Z", "day")).toMatch(/Mar/);
    expect(bucketLabel("2026-03-04T15:00:00.000Z", "hour", "tooltip")).toMatch(/Mar/);
    expect(bucketLabel("garbage", "day")).toBe("");
  });
});

/* ─── chart ─────────────────────────────────────────────────────────────────── */

describe("chart math", () => {
  it("picks nice axis maxima and integer steps", () => {
    expect(niceScale(0)).toEqual({ max: 4, step: 1, ticks: [0, 1, 2, 3, 4] });
    expect(niceScale(87).max).toBe(100);
    expect(niceScale(87).ticks).toEqual([0, 25, 50, 75, 100]);
    expect(niceScale(3).step).toBe(1);
    const big = niceScale(12_345);
    expect(big.max).toBeGreaterThanOrEqual(12_345);
    expect(big.ticks.at(-1)).toBe(big.max);
  });

  it("projects points into the plot box", () => {
    const box = { left: 10, top: 0, width: 100, height: 50 };
    const pts = projectPoints([0, 5, 10], 10, box);
    expect(pts).toEqual([
      { x: 10, y: 50 },
      { x: 60, y: 25 },
      { x: 110, y: 0 },
    ]);
    expect(projectPoints([3], 0, box)[0]!.x).toBe(60);
  });

  it("builds line, smooth and area paths", () => {
    const pts = [
      { x: 0, y: 10 },
      { x: 10, y: 0 },
      { x: 20, y: 5 },
    ];
    expect(linePath(pts)).toBe("M0,10L10,0L20,5");
    expect(linePath([])).toBe("");
    expect(smoothPath(pts)).toMatch(/^M0,10C/);
    expect(areaPath(pts, 10, false)).toBe("M0,10L10,0L20,5L20,10L0,10Z");
  });

  it("finds the hovered index and thins labels", () => {
    const box = { left: 0, top: 0, width: 100, height: 10 };
    expect(nearestIndex(11, 49, box)).toBe(5);
    expect(nearestIndex(11, -20, box)).toBe(0);
    expect(nearestIndex(11, 500, box)).toBe(10);
    expect(labelIndices(5, 10)).toEqual([0, 1, 2, 3, 4]);
    const many = labelIndices(90, 8);
    expect(many.length).toBeLessThanOrEqual(9);
    expect(many.at(-1)).toBe(89);
    expect(labelIndices(0, 5)).toEqual([]);
  });

  it("sizes bars relative to the largest", () => {
    expect(barPercents([50, 100, 0])).toEqual([50, 100, 0]);
    expect(barPercents([0, 0])).toEqual([0, 0]);
  });
});

/* ─── analytics view model ──────────────────────────────────────────────────── */

describe("analytics view model", () => {
  const now = Date.parse("2026-07-04T12:34:00.000Z");

  it("rounds ranges up to the bucket boundary and keeps the preset length", () => {
    expect(rangeFor("24h", "hour", now)).toEqual({
      from: "2026-07-03T13:00:00.000Z",
      to: "2026-07-04T13:00:00.000Z",
    });
    const r = rangeFor("30d", "day", now);
    expect(r.to).toBe("2026-07-05T00:00:00.000Z");
    expect(Date.parse(r.to) - Date.parse(r.from)).toBe(30 * 86_400_000);
    expect(previousRange(r)).toEqual({ from: "2026-05-06T00:00:00.000Z", to: r.from });
  });

  it("offers hourly buckets only up to a week, within the sink's intervals", () => {
    expect(intervalsFor("24h")).toEqual(["hour"]);
    expect(intervalsFor("7d")).toEqual(["day", "hour"]);
    expect(intervalsFor("90d")).toEqual(["day"]);
    expect(intervalsFor("24h", { intervals: ["day"] })).toEqual(["day"]);
    expect(defaultInterval("7d")).toBe("day");
  });

  it("knows which breakdowns a sink without cross-filtering can answer", () => {
    const kv = { crossFilter: false };
    expect(
      canQuery(
        { crossFilter: true },
        { groupBy: "os", filters: { country: ["DE"], device: ["mobile"] } },
      ),
    ).toBe(true);
    expect(canQuery(kv, { groupBy: "os" })).toBe(true);
    expect(canQuery(kv, { groupBy: "country", filters: { country: ["DE"] } })).toBe(true);
    expect(canQuery(kv, { groupBy: "os", filters: { country: ["DE"] } })).toBe(false);
    expect(canQuery(kv, { groupBy: "link", filters: { country: ["DE"] } })).toBe(false);
    expect(canQuery(kv, { groupBy: "link", filters: { country: ["DE"] }, linkIds: ["l1"] })).toBe(
      true,
    );
    expect(canQuery(kv, { filters: { country: ["DE"], os: ["ios"] } })).toBe(false);
    expect(canQuery(kv, { groupBy: "os", filters: { link: ["l1"] } })).toBe(true);
  });

  it("toggles filters, replacing the dimension when the sink cannot combine them", () => {
    const cross = { crossFilter: true };
    const kv = { crossFilter: false };
    let f = toggleFilter({}, "country", "DE", cross);
    f = toggleFilter(f, "device", "mobile", cross);
    expect(f).toEqual({ country: ["DE"], device: ["mobile"] });
    expect(toggleFilter(f, "country", "DE", cross)).toEqual({ device: ["mobile"] });
    expect(toggleFilter({ country: ["DE"], link: ["l1"] }, "os", "ios", kv)).toEqual({
      link: ["l1"],
      os: ["ios"],
    });
    expect(toggleFilter({ country: ["DE"] }, "country", "FR", kv)).toEqual({
      country: ["DE", "FR"],
    });
  });

  it("round-trips filters through the URL", () => {
    const filters = { country: ["US", "DE"], referrer: ["t.co"], utm_campaign: ["a,b"] };
    const encoded = encodeFilters(filters);
    expect(encoded).toBe("country:US,DE;referrer:t.co;utm_campaign:a%2Cb");
    expect(decodeFilters(encoded, ANALYTICS_DIMENSIONS)).toEqual(filters);
    expect(decodeFilters("bogus:1;:x;country:", ANALYTICS_DIMENSIONS)).toEqual({});
    expect(decodeFilters(null, ANALYTICS_DIMENSIONS)).toEqual({});
  });

  it("lists metrics per capability and reads them", () => {
    expect(availableMetrics({ uniques: false })).not.toContain("uniques");
    expect(availableMetrics({ uniques: true })).toContain("uniques");
    const m = { clicks: 10, botClicks: 1, leads: 2, sales: 1, saleAmount: 900 };
    expect(metricValue(m, "uniques")).toBe(0);
    expect(metricValue(m, "saleAmount")).toBe(900);
    expect(conversionRate(m)).toBe(20);
    expect(conversionRate({ clicks: 0, leads: 0 })).toBeNull();
  });

  it("serializes analytics queries", () => {
    expect(
      analyticsQueryString({
        from: "a",
        to: "b",
        interval: "day",
        linkIds: ["l1", "l2"],
        filters: { country: ["US", "DE"], os: [] },
      }),
    ).toBe("?from=a&to=b&interval=day&linkIds=l1%2Cl2&filter%5Bcountry%5D=US%2CDE");
    expect(toQuery({ a: "", b: undefined, c: [], d: false })).toBe("?d=false");
    expect(toQuery({})).toBe("");
  });
});

/* ─── rules model ───────────────────────────────────────────────────────────── */

describe("rule-editor model", () => {
  it("creates conditions per field and converts between them", () => {
    expect(newCondition("query")).toEqual({ field: "query", key: "", op: "in", values: [] });
    expect(newCondition("time")).toEqual({ field: "time" });
    expect(newCondition("qr")).toEqual({ field: "qr", op: "in", values: ["true"] });
    const c = { field: "country" as const, op: "not_in" as const, values: ["DE"] };
    expect(changeConditionField(c, "device")).toEqual({
      field: "device",
      op: "not_in",
      values: [],
    });
    expect(changeConditionField(c, "country")).toBe(c);
    expect(changeConditionField(c, "time")).toEqual({ field: "time" });
  });

  it("switches a rule between a URL and an A/B split", () => {
    const rule = { ...newRule("country"), url: "https://a.com" };
    expect(rule.id.startsWith(DRAFT_ID_PREFIX)).toBe(true);
    const ab = setRuleTarget(rule, "variants");
    expect(ruleTarget(ab)).toBe("variants");
    expect(ab.url).toBeUndefined();
    expect(ab.variants).toEqual([
      { id: "a", url: "https://a.com", weight: 50 },
      { id: "b", url: "", weight: 50 },
    ]);
    const back = setRuleTarget(ab, "url");
    expect(back).toMatchObject({ url: "https://a.com" });
    expect(back.variants).toBeUndefined();
    expect(setRuleTarget(back, "url")).toBe(back);
  });

  it("computes variant ids and percentages summing to 100", () => {
    expect(nextVariantId([{ id: "a", url: "", weight: 1 }])).toBe("b");
    expect(variantPercents([{ weight: 1 }, { weight: 1 }, { weight: 1 }])).toEqual([34, 33, 33]);
    expect(variantPercents([{ weight: 50 }, { weight: 30 }, { weight: 20 }])).toEqual([50, 30, 20]);
    expect(variantPercents([{ weight: 0 }, { weight: -1 }])).toEqual([0, 0]);
  });

  it("moves rules and splits value lists", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(splitValues(" us, de ,us\nfr", true)).toEqual(["US", "DE", "FR"]);
  });

  it("validates rules", () => {
    const issues = validateRules([
      { id: "r1", when: [{ field: "country", op: "in", values: [] }], url: "https://ok.com" },
      { id: "r2", when: [{ field: "query", key: "", op: "in", values: [] }], url: "nope" },
      {
        id: "r3",
        when: [{ field: "time", after: "2026-02-01T00:00:00Z", before: "2026-01-01T00:00:00Z" }],
        url: "https://ok.com",
      },
      { id: "r4", when: [], variants: [{ url: "https://a.com", weight: 0 }] },
      { id: "r5", when: [{ field: "time" }], url: "https://ok.com" },
    ]);
    expect(issues.map((i) => i.rule)).toEqual([0, 1, 1, 1, 2, 3, 3, 4]);
    expect(validateRules([{ id: "ok", when: [], url: "myapp://open" }])).toEqual([]);
  });

  it("strips draft ids and empty bits for the API", () => {
    const input = rulesToInput([
      {
        id: "draft_x",
        name: "  ",
        when: [{ field: "query", key: " ref ", op: "exists", values: ["x"] }],
        url: " https://a.com ",
      },
      {
        id: "rule_1",
        name: "AB",
        when: [{ field: "time", after: "2026-01-01T00:00:00Z" }],
        variants: [
          { id: "a", url: "https://a.com", weight: 1 },
          { url: "https://b.com", weight: 1 },
        ],
      },
    ]);
    expect(input).toEqual([
      { when: [{ field: "query", key: "ref", op: "exists" }], url: "https://a.com" },
      {
        id: "rule_1",
        name: "AB",
        when: [{ field: "time", after: "2026-01-01T00:00:00Z" }],
        variants: [
          { id: "a", url: "https://a.com", weight: 1 },
          { url: "https://b.com", weight: 1 },
        ],
      },
    ]);
  });

  it("describes conditions and rules in words", () => {
    expect(describeCondition({ field: "country", op: "in", values: ["DE", "AT"] })).toBe(
      "Country is Germany or Austria",
    );
    expect(
      describeCondition({ field: "os", op: "not_in", values: ["ios", "android", "windows"] }),
    ).toBe("OS is not iOS, Android or Windows");
    expect(describeCondition({ field: "qr", op: "in", values: ["true"] })).toBe(
      "Scanned from a QR code",
    );
    expect(describeCondition({ field: "query", key: "ref", op: "missing" })).toBe(
      "?ref is missing",
    );
    expect(describeCondition({ field: "time", before: "2026-01-01T10:00:00Z" })).toBe(
      "Before 2026-01-01 10:00 UTC",
    );
    expect(
      describeRule({
        id: "r",
        when: [],
        variants: [
          { url: "a", weight: 1 },
          { url: "b", weight: 3 },
        ],
      }),
    ).toBe("Always → A/B 25/75");
  });
});

/* ─── link form ─────────────────────────────────────────────────────────────── */

describe("link form", () => {
  it("round-trips datetime-local values", () => {
    const iso = "2026-03-04T05:06:00.000Z";
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
    expect(toLocalInput(undefined)).toBe("");
    expect(fromLocalInput("")).toBeNull();
  });

  it("builds create input with only what was set", () => {
    const draft = draftFromLink(null, { domain: "go.acme.com" });
    draft.url = " https://acme.com ";
    draft.tags = ["a"];
    draft.utm.source = "news";
    draft.passwordMode = "set";
    draft.password = "secret";
    draft.redirectStatus = "301";
    expect(draftToCreateInput(draft)).toEqual({
      url: "https://acme.com",
      domain: "go.acme.com",
      tags: ["a"],
      utm: { source: "news" },
      redirectStatus: 301,
      password: "secret",
    });
  });

  it("patches only changed fields, with null to clear", () => {
    const original = link({
      title: "Old",
      utm: { source: "x" },
      expiresAt: "2026-05-01T00:00:00.000Z",
      hasPassword: true,
    });
    const draft = draftFromLink(original);
    expect(draft.passwordMode).toBe("keep");
    expect(draftToPatch(draft, original)).toEqual({});
    expect(isDirty(draft, original)).toBe(false);
    draft.title = "";
    draft.utm.source = "";
    draft.tags = ["sale", "new"];
    draft.passwordMode = "remove";
    expect(draftToPatch(draft, original)).toEqual({
      title: null,
      utm: null,
      tags: ["sale", "new"],
      password: null,
    });
    expect(isDirty(draft, original)).toBe(true);
    expect(isDirty(draftFromLink(null))).toBe(false);
  });

  it("merges and extracts UTM parameters", () => {
    expect(applyUtm("https://a.com/?utm_source=keep", { source: "x", medium: "email" })).toBe(
      "https://a.com/?utm_source=keep&utm_medium=email",
    );
    expect(applyUtm("not a url", { source: "x" })).toBe("not a url");
    expect(extractUtm("https://a.com/p?utm_source=nl&id=1&utm_campaign=spring")).toEqual({
      url: "https://a.com/p?id=1",
      utm: { source: "nl", campaign: "spring" },
    });
    expect(extractUtm("https://a.com/p?id=1")).toBeNull();
  });

  it("checks slugs with the package's own rules", () => {
    expect(slugIssue("")).toBeNull();
    expect(slugIssue("spring-sale")).toBeNull();
    expect(slugIssue("p/42")).toBeNull();
    expect(slugIssue("bad slug")).not.toBeNull();
    expect(slugIssue("api")).toMatch(/reserved/);
  });
});

/* ─── shell + errors ────────────────────────────────────────────────────────── */

describe("permissions and errors", () => {
  it("gates actions by readonly mode and viewer grants", () => {
    expect(canPerform({ readonly: false, viewer: false }, "link:delete")).toBe(true);
    expect(canPerform({ readonly: true, viewer: false }, "link:create")).toBe(false);
    expect(canPerform({ readonly: true, viewer: false }, "analytics:read")).toBe(true);
    expect(canPerform({ readonly: false, viewer: true }, "link:read")).toBe(true);
    expect(canPerform({ readonly: false, viewer: true }, "link:create")).toBe(false);
    expect(
      canPerform({ readonly: false, viewer: true, allow: ["link:create"] }, "link:create"),
    ).toBe(true);
  });

  it("renders API errors with field issues", () => {
    const err = new LinksApiError(400, {
      status: 400,
      error: "Validation failed",
      errors: [{ path: "link.url", message: "must be absolute" }],
    });
    expect(errorMessage(err)).toBe("Validation failed — link.url: must be absolute");
    expect(errorMessage(new LinksApiError(404, { status: 404, error: "" }), "x")).toBe("x");
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage(42, "fallback")).toBe("fallback");
  });
});
