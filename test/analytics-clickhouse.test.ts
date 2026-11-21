import { afterAll, describe, expect, test } from "vitest";
import { runAnalyticsContractTests } from "./analytics-contract.ts";
import { clickhouseSchema, createClickHouseAnalytics } from "../src/analytics/clickhouse.ts";
import type { ClickEvent, SaleEvent } from "../src/schema.ts";

interface Captured {
  url: URL;
  init: RequestInit;
  body: string;
}

function mockFetch(respond: (req: Captured) => unknown = () => ({ data: [] })) {
  const calls: Captured[] = [];
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const req = { url: new URL(String(input)), init, body: String(init.body ?? "") };
    calls.push(req);
    const out = respond(req);
    if (out instanceof Response) return out;
    return new Response(out === undefined ? "" : JSON.stringify(out), { status: 200 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const click: ClickEvent = {
  type: "click",
  id: "clk_1",
  at: "2026-03-10T12:34:56.789Z",
  tenant: "acme",
  linkId: "lnk_1",
  domain: "go.acme.com",
  slug: "launch",
  destination: "https://acme.com",
  device: "mobile",
  os: "iOS",
  browser: "Safari",
  referrerHost: "(direct)",
  country: "US",
  visitor: "v1",
  bot: false,
  qr: true,
};

const sale: SaleEvent = {
  type: "sale",
  id: "sal_1",
  at: "2026-03-10T13:00:00.000Z",
  tenant: "acme",
  linkId: "lnk_1",
  domain: "go.acme.com",
  slug: "launch",
  clickId: "clk_1",
  customerId: "cus_1",
  name: "Purchase",
  amount: 4999,
  currency: "USD",
};

describe("clickhouse sink (mocked fetch)", () => {
  test("ingest posts JSONEachRow with the statement in query=", async () => {
    const { fetch, calls } = mockFetch(() => undefined);
    const sink = createClickHouseAnalytics({
      url: "http://ch.local:8123",
      database: "analytics",
      table: "events",
      username: "links",
      password: "secret",
      fetch,
    });
    await sink.ingest([click, sale]);
    expect(calls).toHaveLength(1);
    const [req] = calls;
    expect(req!.url.origin).toBe("http://ch.local:8123");
    expect(req!.url.searchParams.get("database")).toBe("analytics");
    expect(req!.url.searchParams.get("query")).toMatch(
      /^INSERT INTO `events` \(tenant, at, type, id, link_id, .*, data\) FORMAT JSONEachRow$/,
    );
    expect(req!.init.method).toBe("POST");
    const headers = req!.init.headers as Record<string, string>;
    expect(headers["X-ClickHouse-User"]).toBe("links");
    expect(headers["X-ClickHouse-Key"]).toBe("secret");
    const rows = req!.body.split("\n").map((l) => JSON.parse(l));
    expect(rows[0]).toMatchObject({
      tenant: "acme",
      at: "2026-03-10 12:34:56.789",
      type: "click",
      link_id: "lnk_1",
      country: "US",
      continent: "(none)",
      city: "(none)",
      device: "mobile",
      referrer: "(direct)",
      utm_source: "(none)",
      qr: "true",
      variant: "(none)",
      bot: 0,
      visitor: "v1",
      amount: 0,
      currency: "",
    });
    expect(JSON.parse(rows[0].data)).toEqual(click);
    expect(rows[1]).toMatchObject({
      type: "sale",
      amount: 4999,
      currency: "USD",
      device: "(none)",
    });
  });

  test("ingest([]) makes no request", async () => {
    const { fetch, calls } = mockFetch();
    await createClickHouseAnalytics({ url: "http://ch.local", fetch }).ingest([]);
    expect(calls).toHaveLength(0);
  });

  test("query binds every user value as a parameter", async () => {
    const evil = "x' OR 1=1 --";
    const { fetch, calls } = mockFetch((req) => {
      if (req.body.includes("AS t,")) {
        return {
          data: [
            {
              t: String(Date.parse("2026-03-10T12:00:00Z")),
              clicks: "2",
              bot_clicks: "1",
              leads: "0",
              sales: "1",
              sale_amount: "4999",
              uniques: "1",
            },
          ],
        };
      }
      if (req.body.includes("AS k,")) {
        return {
          data: [
            {
              k: "mobile",
              clicks: "1",
              bot_clicks: "0",
              leads: "0",
              sales: "0",
              sale_amount: "0",
              uniques: "1",
            },
            {
              k: "desktop",
              clicks: "1",
              bot_clicks: "0",
              leads: "0",
              sales: "0",
              sale_amount: "0",
              uniques: "1",
            },
          ],
        };
      }
      return {
        data: [
          {
            clicks: "2",
            bot_clicks: "1",
            leads: "0",
            sales: "1",
            sale_amount: "4999",
            uniques: "1",
          },
        ],
      };
    });
    const sink = createClickHouseAnalytics({ url: "http://ch.local", fetch });
    const result = await sink.query({
      tenant: evil,
      from: "2026-03-10T11:00:00Z",
      to: "2026-03-10T14:00:00Z",
      linkIds: ["lnk_1", evil],
      filters: { country: [evil], device: [] },
      interval: "hour",
      groupBy: "device",
      limit: 5,
    });
    expect(calls).toHaveLength(3);
    for (const req of calls) {
      expect(req.body).not.toContain(evil);
      expect(req.body).not.toContain("OR 1=1");
      expect(req.body).toMatch(/tenant = \{p0:String\}/);
      expect(req.body).toMatch(/link_id IN \{p3:Array\(String\)\}/);
      expect(req.body).toMatch(/country IN \{p4:Array\(String\)\}/);
      expect(req.body).not.toMatch(/device IN/);
      expect(req.body).toMatch(/FORMAT JSON$/);
      expect(req.url.searchParams.get("param_p0")).toBe(evil);
      expect(req.url.searchParams.get("param_p1")).toBe(String(Date.parse("2026-03-10T11:00:00Z")));
      expect(req.url.searchParams.get("param_p3")).toBe("['lnk_1','x\\' OR 1=1 --']");
      expect(req.url.searchParams.has("query")).toBe(false);
    }
    const breakdown = calls.find((c) => c.body.includes("AS k,"))!;
    expect(breakdown.body).toMatch(/SELECT device AS k,/);
    expect(breakdown.body).toMatch(
      /ORDER BY clicks DESC, leads DESC, sales DESC, sale_amount DESC, k ASC LIMIT 5/,
    );

    expect(result.totals).toEqual({
      clicks: 2,
      botClicks: 1,
      leads: 0,
      sales: 1,
      saleAmount: 4999,
      uniques: 1,
    });
    expect(result.timeseries!.map((b) => [b.at, b.clicks])).toEqual([
      ["2026-03-10T11:00:00.000Z", 0],
      ["2026-03-10T12:00:00.000Z", 2],
      ["2026-03-10T13:00:00.000Z", 0],
    ]);
    expect(result.timeseries![0]!.uniques).toBe(0);
    // Re-sorted client-side: ties by key asc.
    expect(result.breakdown!.map((r) => r.key)).toEqual(["desktop", "mobile"]);
  });

  test("events() selects the data column newest first and parses it", async () => {
    const { fetch, calls } = mockFetch(() => ({ data: [{ data: JSON.stringify(click) }] }));
    const sink = createClickHouseAnalytics({ url: "http://ch.local", fetch });
    const events = await sink.events({
      tenant: "acme",
      before: "2026-03-11T00:00:00Z",
      types: ["click"],
      limit: 5,
    });
    expect(events).toEqual([click]);
    const [req] = calls;
    expect(req!.body).toMatch(
      /^SELECT data AS data FROM `links_events` WHERE tenant = \{p0:String\}/,
    );
    expect(req!.body).toMatch(/at < fromUnixTimestamp64Milli\(\{p1:Int64\}, 'UTC'\)/);
    expect(req!.body).toMatch(/type IN \{p2:Array\(String\)\}/);
    expect(req!.body).toMatch(/NOT \(bot = 1\)/);
    expect(req!.body).toMatch(
      /ORDER BY toUnixTimestamp64Milli\(at\) DESC, id DESC LIMIT 5 FORMAT JSON$/,
    );
  });

  test("deleteLink issues a parameterized lightweight DELETE", async () => {
    const { fetch, calls } = mockFetch(() => undefined);
    await createClickHouseAnalytics({ url: "http://ch.local", fetch }).deleteLink("acme", "lnk_1");
    expect(calls[0]!.body).toBe(
      "DELETE FROM `links_events` WHERE tenant = {p0:String} AND link_id = {p1:String}",
    );
    expect(calls[0]!.url.searchParams.get("param_p1")).toBe("lnk_1");
  });

  test("createTable runs the DDL once before the first request", async () => {
    const { fetch, calls } = mockFetch();
    const sink = createClickHouseAnalytics({
      url: "http://ch.local",
      table: "t1",
      fetch,
      createTable: true,
      settings: { async_insert: "1" },
    });
    await Promise.all([
      sink.ingest([click]),
      sink.query({ tenant: "a", from: click.at, to: sale.at }),
    ]);
    const ddl = calls.filter((c) => c.body.startsWith("CREATE TABLE"));
    expect(ddl).toHaveLength(1);
    expect(calls[0]!.body).toBe(clickhouseSchema({ table: "t1" }));
    expect(calls.every((c) => c.url.searchParams.get("async_insert") === "1")).toBe(true);
  });

  test("errors carry the status and server message", async () => {
    const { fetch } = mockFetch(() => new Response("Code: 60. Table missing", { status: 404 }));
    const sink = createClickHouseAnalytics({ url: "http://ch.local", fetch });
    await expect(sink.ingest([click])).rejects.toThrow(
      /ClickHouse request failed \(404\): Code: 60/,
    );
    await expect(sink.query({ tenant: "a", from: click.at, to: sale.at })).rejects.toThrow(
      /ClickHouse query failed \(404\)/,
    );
  });

  test("rejects unsafe identifiers and invalid times", async () => {
    expect(() => createClickHouseAnalytics({ url: "http://x", table: "t; DROP" })).toThrow(
      /Invalid table/,
    );
    expect(() => clickhouseSchema({ database: "a.b" })).toThrow(/Invalid database/);
    const { fetch } = mockFetch();
    const sink = createClickHouseAnalytics({ url: "http://x", fetch });
    await expect(sink.query({ tenant: "a", from: "nope", to: sale.at })).rejects.toThrow(
      /Invalid from time/,
    );
  });

  test("schema: MergeTree ordered by (tenant, at)", () => {
    const ddl = clickhouseSchema({
      database: "analytics",
      table: "events",
      engine: "ReplicatedMergeTree",
    });
    expect(ddl).toMatch(/^CREATE TABLE IF NOT EXISTS `analytics`\.`events` \(/);
    expect(ddl).toMatch(/at DateTime64\(3, 'UTC'\)/);
    expect(ddl).toMatch(
      /ENGINE = ReplicatedMergeTree\nPARTITION BY toYYYYMM\(at\)\nORDER BY \(tenant, at\)$/,
    );
  });
});

// Live conformance: CLICKHOUSE_URL=http://localhost:8123 (CLICKHOUSE_USER / CLICKHOUSE_PASSWORD).
const url = process.env.CLICKHOUSE_URL;
if (url) {
  const table = `links_events_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const headers: Record<string, string> = {
    "X-ClickHouse-User": process.env.CLICKHOUSE_USER ?? "default",
  };
  if (process.env.CLICKHOUSE_PASSWORD)
    headers["X-ClickHouse-Key"] = process.env.CLICKHOUSE_PASSWORD;
  const sink = createClickHouseAnalytics({
    url,
    username: process.env.CLICKHOUSE_USER,
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE,
    table,
    createTable: true,
  });
  afterAll(async () => {
    const drop = new URL(url);
    drop.searchParams.set("database", process.env.CLICKHOUSE_DATABASE ?? "default");
    await fetch(drop, { method: "POST", headers, body: `DROP TABLE IF EXISTS \`${table}\`` });
  }, 30_000);
  runAnalyticsContractTests("clickhouse (live)", () => sink, { timeout: 30_000 });
} else {
  describe.skip("clickhouse (live) — set CLICKHOUSE_URL to run", () => {
    test("skipped", () => {});
  });
}
