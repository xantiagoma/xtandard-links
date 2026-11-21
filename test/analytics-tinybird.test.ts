import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { runAnalyticsContractTests } from "./analytics-contract.ts";
import { liveClickHouse, mockFetch } from "./analytics-http.ts";
import { clickhouseSchema } from "../src/analytics/clickhouse.ts";
import { createTinybirdAnalytics, tinybirdDatasource } from "../src/analytics/tinybird.ts";
import type { ClickEvent } from "../src/schema.ts";

const click: ClickEvent = {
  type: "click",
  id: "clk_1",
  at: "2026-03-10T12:34:56.789Z",
  tenant: "acme",
  linkId: "lnk_1",
  domain: "go.acme.com",
  slug: "launch",
  destination: "https://acme.com",
  device: "desktop",
  os: "macOS",
  browser: "Chrome",
  referrerHost: "(direct)",
  bot: false,
  qr: false,
};

describe("tinybird sink (mocked fetch)", () => {
  test("ingest posts NDJSON to the Events API", async () => {
    const { fetch, calls } = mockFetch(() => ({ successful_rows: 2, quarantined_rows: 0 }));
    const sink = createTinybirdAnalytics({
      token: "tb_token",
      baseUrl: "https://api.us-east.aws.tinybird.co/",
      datasource: "my_events",
      wait: true,
      fetch,
    });
    await sink.ingest([click, { ...click, id: "clk_2", bot: true }]);
    const [req] = calls;
    expect(req!.url.origin + req!.url.pathname).toBe(
      "https://api.us-east.aws.tinybird.co/v0/events",
    );
    expect(req!.url.searchParams.get("name")).toBe("my_events");
    expect(req!.url.searchParams.get("wait")).toBe("true");
    expect((req!.init.headers as Record<string, string>).Authorization).toBe("Bearer tb_token");
    const rows = req!.body.split("\n").map((line) => JSON.parse(line));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      tenant: "acme",
      at: "2026-03-10 12:34:56.789",
      bot: 0,
      country: "(none)",
    });
    expect(rows[1]).toMatchObject({ id: "clk_2", bot: 1 });
    expect(JSON.parse(rows[0].data)).toEqual(click);
  });

  test("ingest([]) makes no request; wait is off by default", async () => {
    const { fetch, calls } = mockFetch();
    const sink = createTinybirdAnalytics({ token: "t", fetch });
    await sink.ingest([]);
    expect(calls).toHaveLength(0);
    await sink.ingest([click]);
    expect(calls[0]!.url.toString()).toBe("https://api.tinybird.co/v0/events?name=links_events");
  });

  test("query posts escaped-literal SQL to /v0/sql and maps rows", async () => {
    const evil = "x' OR 1=1 --\\";
    const { fetch, calls } = mockFetch((req) => {
      const q = new URLSearchParams(req.body).get("q")!;
      if (q.includes("AS k,")) {
        return {
          data: [
            { k: "US", clicks: 3, bot_clicks: 0, leads: 1, sales: 0, sale_amount: 0, uniques: 2 },
          ],
        };
      }
      return {
        data: [
          { clicks: "3", bot_clicks: "0", leads: "1", sales: "0", sale_amount: "0", uniques: "2" },
        ],
      };
    });
    const sink = createTinybirdAnalytics({ token: "t", fetch });
    const result = await sink.query({
      tenant: evil,
      from: "2026-03-10T00:00:00Z",
      to: "2026-03-11T00:00:00Z",
      filters: { country: ["US", evil] },
      groupBy: "country",
    });
    expect(calls).toHaveLength(2);
    const q = new URLSearchParams(calls[0]!.body).get("q")!;
    expect(calls[0]!.url.toString()).toBe("https://api.tinybird.co/v0/sql");
    expect((calls[0]!.init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(q).toContain("FROM links_events WHERE tenant = 'x\\' OR 1=1 --\\\\'");
    expect(q).toContain("country IN ('US', 'x\\' OR 1=1 --\\\\')");
    expect(q).toContain(
      `at >= fromUnixTimestamp64Milli(${Date.parse("2026-03-10T00:00:00Z")}, 'UTC')`,
    );
    expect(q).toMatch(/FORMAT JSON$/);
    expect(result.totals).toEqual({
      clicks: 3,
      botClicks: 0,
      leads: 1,
      sales: 0,
      saleAmount: 0,
      uniques: 2,
    });
    expect(result.breakdown).toEqual([
      { key: "US", clicks: 3, botClicks: 0, leads: 1, sales: 0, saleAmount: 0, uniques: 2 },
    ]);
  });

  test("events() selects data newest first", async () => {
    const { fetch, calls } = mockFetch(() => ({ data: [{ data: JSON.stringify(click) }] }));
    const sink = createTinybirdAnalytics({ token: "t", fetch });
    expect(await sink.events({ tenant: "acme", linkIds: [], includeBots: true })).toEqual([click]);
    const q = new URLSearchParams(calls[0]!.body).get("q")!;
    expect(q).toBe(
      "SELECT data AS data FROM links_events WHERE tenant = 'acme' AND 0 = 1 " +
        "ORDER BY toUnixTimestamp64Milli(at) DESC, id DESC LIMIT 50 FORMAT JSON",
    );
  });

  test("deleteLink posts an escaped delete_condition", async () => {
    const { fetch, calls } = mockFetch(() => ({ job_id: "j1" }));
    const sink = createTinybirdAnalytics({ token: "t", fetch });
    await sink.deleteLink("acme", "lnk_'1");
    expect(calls[0]!.url.toString()).toBe(
      "https://api.tinybird.co/v0/datasources/links_events/delete",
    );
    expect(new URLSearchParams(calls[0]!.body).get("delete_condition")).toBe(
      "tenant = 'acme' AND link_id = 'lnk_\\'1'",
    );
  });

  test("errors carry the status and message", async () => {
    const { fetch } = mockFetch(() => new Response('{"error":"bad token"}', { status: 403 }));
    const sink = createTinybirdAnalytics({ token: "t", fetch });
    await expect(sink.ingest([click])).rejects.toThrow(
      /Tinybird ingest failed \(403\): .*bad token/,
    );
    await expect(sink.query({ tenant: "a", from: click.at, to: click.at })).rejects.toThrow(
      /Tinybird query failed \(403\)/,
    );
    await expect(sink.deleteLink("a", "b")).rejects.toThrow(/Tinybird delete failed \(403\)/);
  });

  test("rejects unsafe datasource names", () => {
    expect(() => createTinybirdAnalytics({ token: "t", datasource: "a-b" })).toThrow(
      /Invalid datasource/,
    );
  });

  test("datasource file", () => {
    const text = tinybirdDatasource({ ttl: "toDateTime(at) + INTERVAL 13 MONTH" });
    expect(text).toContain("SCHEMA >\n    `tenant` LowCardinality(String) `json:$.tenant`,");
    expect(text).toContain("`at` DateTime64(3, 'UTC') `json:$.at`");
    expect(text).toContain("`data` String `json:$.data`\n");
    expect(text).toContain('ENGINE "MergeTree"');
    expect(text).toContain('ENGINE_SORTING_KEY "tenant, at"');
    expect(text).toContain('ENGINE_TTL "toDateTime(at) + INTERVAL 13 MONTH"');
    expect(tinybirdDatasource()).not.toContain("ENGINE_TTL");
  });
});

// The SQL Tinybird runs is ClickHouse SQL: with CLICKHOUSE_URL set, emulate the
// Events / SQL / delete APIs over a live ClickHouse and run the full suite.
const ch = liveClickHouse();
if (ch) {
  const datasource = ch.uniqueName("links_tb_test");
  const tinybirdOverClickHouse = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const body = String(init.body ?? "");
    if (url.pathname === "/v0/events") {
      return ch.run(`INSERT INTO ${url.searchParams.get("name")} FORMAT JSONEachRow`, body);
    }
    if (url.pathname === "/v0/sql") return ch.run(new URLSearchParams(body).get("q")!);
    const del = /^\/v0\/datasources\/(\w+)\/delete$/.exec(url.pathname);
    if (del) {
      return ch.run(
        `DELETE FROM ${del[1]} WHERE ${new URLSearchParams(body).get("delete_condition")}`,
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  beforeAll(async () => {
    await ch.run(clickhouseSchema({ table: datasource }));
  }, 30_000);
  afterAll(async () => {
    await ch.run(`DROP TABLE IF EXISTS ${datasource}`);
  }, 30_000);
  const sink = createTinybirdAnalytics({
    token: "t",
    baseUrl: "http://tinybird.local",
    datasource,
    fetch: tinybirdOverClickHouse,
  });
  runAnalyticsContractTests("tinybird SQL over ClickHouse (live)", () => sink, { timeout: 30_000 });
}
