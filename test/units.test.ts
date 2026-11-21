import { describe, expect, test } from "vitest";
import {
  buildAppleAppSiteAssociation,
  buildDestination,
  cloudflareGeo,
  continentOf,
  createClickIngestor,
  durationToMs,
  edgeHeadersGeo,
  evaluateRules,
  fnv1a,
  generateSlug,
  hashPassword,
  idPattern,
  idTime,
  isBot,
  isPreviewBot,
  matchesCondition,
  newId,
  parseAcceptLanguage,
  parseUserAgent,
  pickVariant,
  protectIp,
  referrerHost,
  slugKey,
  slugProblem,
  truncateIp,
  vercelGeo,
  verifyPassword,
  visitorHash,
  withInstallReferrer,
  type AnalyticsEvent,
  type AnalyticsSink,
  type VisitorContext,
} from "../src/index.ts";
import { USER_AGENTS } from "../src/testing.ts";

const ctx = (over: Partial<VisitorContext> = {}): VisitorContext => ({
  device: "desktop",
  os: "macos",
  browser: "chrome",
  country: "US",
  continent: "NA",
  languages: ["en"],
  referrerHost: "(direct)",
  qr: false,
  query: new URLSearchParams(),
  now: Date.parse("2026-06-01T12:00:00Z"),
  ...over,
});

describe("ids, slugs, durations, passwords", () => {
  test("ids are time-sortable and decodable", () => {
    const a = newId("lnk", 1_000);
    const b = newId("lnk", 2_000);
    expect(a < b).toBe(true);
    expect(idPattern("lnk").test(a)).toBe(true);
    expect(idTime(a)).toBe(1_000);
    expect(Number.isNaN(idTime("lnk_bad"))).toBe(true);
    const burst = Array.from({ length: 50 }, () => newId("clk", 5_000));
    expect([...burst].sort()).toEqual(burst);
  });

  test("slug normalization, validation and generation", () => {
    expect(slugKey("Sale")).toBe("sale");
    expect(slugKey("Sale", true)).toBe("Sale");
    expect(slugKey("café")).toBe("café");
    expect(slugProblem("ok-slug_1.2~x/y")).toBeNull();
    expect(slugProblem("")).toMatch(/empty/);
    expect(slugProblem("a b")).toMatch(/letters/);
    expect(slugProblem("..")).not.toBeNull();
    expect(slugProblem("API/x")).toMatch(/reserved/);
    expect(slugProblem("x".repeat(191))).toMatch(/190/);
    expect(generateSlug()).toMatch(/^[23456789a-z]{7}$/);
    expect(generateSlug(10, true)).toHaveLength(10);
  });

  test("durations", () => {
    expect(durationToMs("90d")).toBe(90 * 86_400_000);
    expect(durationToMs(5)).toBe(5);
    expect(() => durationToMs("5 weeks" as never)).toThrow();
    expect(() => durationToMs(-1)).toThrow();
  });

  test("password hashing round-trips", async () => {
    const h = await hashPassword("pw", 1000);
    expect(await verifyPassword("pw", h)).toBe(true);
    expect(await verifyPassword("nope", h)).toBe(false);
    expect(await verifyPassword("pw", { ...h, algorithm: "x" as never })).toBe(false);
  });
});

describe("user agents and bots", () => {
  test("parses common agents", () => {
    expect(parseUserAgent(USER_AGENTS.iphone)).toMatchObject({
      device: "mobile",
      os: "ios",
      browser: "safari",
      bot: false,
    });
    expect(parseUserAgent(USER_AGENTS.android)).toMatchObject({
      device: "mobile",
      os: "android",
      browser: "chrome",
    });
    expect(parseUserAgent(USER_AGENTS.ipad)).toMatchObject({ device: "tablet", os: "ios" });
    expect(parseUserAgent(USER_AGENTS.windowsEdge)).toMatchObject({
      device: "desktop",
      os: "windows",
      browser: "edge",
    });
    expect(parseUserAgent(USER_AGENTS.linuxFirefox)).toMatchObject({
      os: "linux",
      browser: "firefox",
    });
    expect(parseUserAgent(USER_AGENTS.googlebot)).toMatchObject({ device: "bot", bot: true });
  });

  test("bot and preview detection", () => {
    for (const ua of [
      USER_AGENTS.googlebot,
      USER_AGENTS.slackbot,
      USER_AGENTS.curl,
      "",
      "python-requests/2.31",
      "Mozilla/5.0 (X11) HeadlessChrome/120",
    ]) {
      expect(isBot(ua)).toBe(true);
    }
    for (const ua of [USER_AGENTS.iphone, USER_AGENTS.macChrome, USER_AGENTS.windowsEdge]) {
      expect(isBot(ua)).toBe(false);
    }
    expect(isPreviewBot(USER_AGENTS.slackbot)).toBe(true);
    expect(isPreviewBot(USER_AGENTS.twitterbot)).toBe(true);
    expect(isPreviewBot("facebookexternalhit/1.1")).toBe(true);
    expect(isPreviewBot(USER_AGENTS.googlebot)).toBe(false);
    expect(isPreviewBot(undefined)).toBe(false);
  });
});

describe("geo and privacy", () => {
  test("cloudflare request.cf and headers", async () => {
    const req = Object.assign(new Request("https://x"), {
      cf: { country: "jp", city: "Tokyo", latitude: "35.6", longitude: "139.7" },
    });
    expect(await cloudflareGeo()(req, undefined)).toMatchObject({
      country: "JP",
      continent: "AS",
      city: "Tokyo",
      latitude: 35.6,
    });
    const h = new Request("https://x", { headers: { "cf-ipcountry": "XX" } });
    expect(await cloudflareGeo()(h, undefined)).toEqual({});
  });

  test("vercel and generic edge headers", async () => {
    const req = new Request("https://x", {
      headers: { "x-vercel-ip-country": "BR", "x-vercel-ip-city": "S%C3%A3o%20Paulo" },
    });
    expect(await vercelGeo()(req, undefined)).toMatchObject({
      country: "BR",
      city: "São Paulo",
      continent: "SA",
    });
    const cf = new Request("https://x", { headers: { "cloudfront-viewer-country": "fr" } });
    expect(await edgeHeadersGeo()(cf, undefined)).toMatchObject({ country: "FR", continent: "EU" });
    expect(await edgeHeadersGeo()(new Request("https://x"), undefined)).toEqual({});
    expect(continentOf("au")).toBe("OC");
  });

  test("ip protection modes", async () => {
    const at = Date.parse("2026-06-01T00:00:00Z");
    expect(await protectIp("1.2.3.4", {}, at)).toBeUndefined();
    expect(await protectIp("1.2.3.4", { ip: "truncate" }, at)).toBe("1.2.3.0");
    expect(truncateIp("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe("2001:db8:85a3::");
    expect(await protectIp("1.2.3.4", { ip: "full" }, at)).toBe("1.2.3.4");
    const h1 = await protectIp("1.2.3.4", { ip: "hash", salt: "s" }, at);
    expect(h1).toMatch(/^[0-9a-f]{32}$/);
    expect(await protectIp("1.2.3.4", { ip: "hash", salt: "s" }, at + 86_400_000)).not.toBe(h1);
  });

  test("visitor hash is daily and tenant-scoped", async () => {
    const at = Date.parse("2026-06-01T00:00:00Z");
    const base = { ip: "1.2.3.4", userAgent: "ua", tenant: "t" };
    const v1 = await visitorHash(base, { salt: "s" }, at);
    expect(await visitorHash(base, { salt: "s" }, at + 3_600_000)).toBe(v1);
    expect(await visitorHash({ ...base, tenant: "u" }, { salt: "s" }, at)).not.toBe(v1);
    expect(await visitorHash(base, { salt: "s", visitor: "none" }, at)).toBeUndefined();
    expect(await visitorHash({ ...base, ip: undefined }, {}, at)).toBeUndefined();
  });
});

describe("rules", () => {
  test("value, query and time conditions", () => {
    expect(matchesCondition({ field: "country", op: "in", values: ["us"] }, ctx())).toBe(true);
    expect(matchesCondition({ field: "country", op: "not_in", values: ["US"] }, ctx())).toBe(false);
    expect(
      matchesCondition(
        { field: "language", op: "in", values: ["de"] },
        ctx({ languages: ["fr", "de"] }),
      ),
    ).toBe(true);
    expect(
      matchesCondition(
        { field: "referrer", op: "in", values: ["google.com"] },
        ctx({ referrerHost: "www.google.com" }),
      ),
    ).toBe(true);
    expect(matchesCondition({ field: "qr", op: "in", values: ["true"] }, ctx({ qr: true }))).toBe(
      true,
    );
    expect(
      matchesCondition(
        { field: "continent", op: "in", values: ["EU"] },
        ctx({ continent: undefined }),
      ),
    ).toBe(false);
    const q = ctx({ query: new URLSearchParams("plan=pro") });
    expect(matchesCondition({ field: "query", key: "plan", op: "in", values: ["PRO"] }, q)).toBe(
      true,
    );
    expect(matchesCondition({ field: "query", key: "plan", op: "exists" }, q)).toBe(true);
    expect(matchesCondition({ field: "query", key: "x", op: "missing" }, q)).toBe(true);
    expect(
      matchesCondition({ field: "query", key: "plan", op: "not_in", values: ["pro"] }, q),
    ).toBe(false);
    expect(
      matchesCondition(
        { field: "time", after: "2026-06-01T00:00:00Z", before: "2026-06-02T00:00:00Z" },
        ctx(),
      ),
    ).toBe(true);
    expect(matchesCondition({ field: "time", before: "2026-06-01T00:00:00Z" }, ctx())).toBe(false);
  });

  test("first match wins; no match returns null", () => {
    const rules = [
      {
        id: "1",
        when: [{ field: "device" as const, op: "in" as const, values: ["mobile"] }],
        url: "https://m",
      },
      { id: "2", when: [], url: "https://all" },
    ];
    expect(evaluateRules(rules, ctx(), "s")).toEqual({ url: "https://all", ruleId: "2" });
    expect(evaluateRules(rules.slice(0, 1), ctx(), "s")).toBeNull();
  });

  test("weighted variants are deterministic and roughly proportional", () => {
    const variants = [
      { url: "a", weight: 3 },
      { url: "b", weight: 1 },
      { url: "z", weight: 0 },
    ];
    expect(pickVariant(variants, "seed")).toEqual(pickVariant(variants, "seed"));
    let a = 0;
    for (let i = 0; i < 4000; i++) if (pickVariant(variants, `s${i}`)?.variant.url === "a") a++;
    expect(a / 4000).toBeGreaterThan(0.7);
    expect(a / 4000).toBeLessThan(0.8);
    expect(pickVariant([{ url: "x", weight: 0 }], "s")).toBeNull();
    expect(fnv1a("")).toBe(0x811c9dc5);
  });

  test("accept-language parsing", () => {
    expect(parseAcceptLanguage("fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5")).toEqual([
      "fr",
      "en",
      "de",
    ]);
    expect(parseAcceptLanguage("en;q=0, de")).toEqual(["de"]);
    expect(parseAcceptLanguage(null)).toEqual([]);
  });
});

describe("destinations and deep links", () => {
  test("buildDestination merges UTM, query and click id", () => {
    expect(
      buildDestination({
        url: "https://x.example/p?utm_source=keep",
        utm: { source: "s", medium: "m" },
        passQuery: new URLSearchParams("a=1&qr=1&xl_id=evil"),
        clickId: "clk_1",
        clickIdParam: "xl_id",
      }),
    ).toBe("https://x.example/p?utm_source=keep&utm_medium=m&a=1&xl_id=clk_1");
    expect(buildDestination({ url: "not a url" })).toBe("not a url");
    expect(referrerHost("https://WWW.Example.com/x")).toBe("www.example.com");
    expect(referrerHost("garbage")).toBe("(direct)");
  });

  test("AASA path components and install referrer", () => {
    expect(
      buildAppleAppSiteAssociation({ appIds: ["A"], paths: ["/p/*", "NOT /admin/*"] }),
    ).toMatchObject({
      applinks: {
        details: [{ components: [{ "/": "/p/*" }, { "/": "/admin/*", exclude: true }] }],
      },
    });
    const url = withInstallReferrer(
      "https://play.google.com/store/apps/details?id=com.a&referrer=utm_source%3Dx",
      "clk_1",
    );
    expect(new URLSearchParams(new URL(url).searchParams.get("referrer") ?? "").get("xl_id")).toBe(
      "clk_1",
    );
    expect(withInstallReferrer("https://example.com", "clk_1")).toBe("https://example.com");
  });
});

describe("click ingestor", () => {
  const event = (i: number): AnalyticsEvent => ({
    type: "click",
    id: `clk_${i}`,
    at: new Date(0).toISOString(),
    tenant: "t",
    linkId: "l",
    domain: "d",
    slug: "s",
    destination: "x",
    device: "desktop",
    os: "macos",
    browser: "chrome",
    referrerHost: "(direct)",
    bot: false,
    qr: false,
  });
  const sinkOf = (ingest: (e: readonly AnalyticsEvent[]) => Promise<void>): AnalyticsSink => ({
    capabilities: { crossFilter: true, uniques: false, events: false, intervals: ["day"] },
    ingest,
    query: async () => ({ totals: { clicks: 0, botClicks: 0, leads: 0, sales: 0, saleAmount: 0 } }),
  });

  test("batches by size and flushes in order", async () => {
    const batches: string[][] = [];
    const ing = createClickIngestor({
      sink: sinkOf(async (b) => void batches.push(b.map((e) => e.id))),
      batchSize: 2,
      flushIntervalMs: 0,
    });
    for (let i = 0; i < 5; i++) ing.capture(event(i));
    await ing.flush();
    expect(batches).toEqual([["clk_0", "clk_1"], ["clk_2", "clk_3"], ["clk_4"]]);
    expect(ing.pending).toBe(0);
  });

  test("retries, then reports; overflow drops oldest with onDrop", async () => {
    let calls = 0;
    const errors: number[] = [];
    const dropped: string[] = [];
    const ing = createClickIngestor({
      sink: sinkOf(async () => {
        calls++;
        throw new Error("down");
      }),
      batchSize: 2,
      maxQueue: 2,
      retries: 2,
      retryBaseMs: 1,
      flushIntervalMs: 0,
      onError: (_e, b) => errors.push(b.length),
      onDrop: (d) => dropped.push(...d.map((e) => e.id)),
    });
    ing.capture(event(0));
    ing.capture(event(1));
    ing.capture(event(2)); // triggers drain of [1,2] after dropping 0
    await ing.flush();
    expect(dropped).toEqual(["clk_0"]);
    expect(calls).toBe(3);
    expect(errors).toEqual([2]);
  });

  test("waitUntil mode flushes in the background; timer mode flushes on interval", async () => {
    const got: string[] = [];
    const ing = createClickIngestor({
      sink: sinkOf(async (b) => void got.push(...b.map((e) => e.id))),
      flushIntervalMs: 5,
    });
    const held: Promise<unknown>[] = [];
    ing.capture(event(1), { waitUntil: (p) => void held.push(p) });
    await Promise.all(held);
    expect(got).toEqual(["clk_1"]);
    ing.capture(event(2));
    await new Promise((r) => setTimeout(r, 30));
    expect(got).toEqual(["clk_1", "clk_2"]);
    await ing.close();
  });
});
