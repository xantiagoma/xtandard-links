import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { runAnalyticsContractTests } from "./analytics-contract.ts";
import { liveClickHouse, mockFetch } from "./analytics-http.ts";
import {
  createAnalyticsEngine,
  toDataPoint,
  type AnalyticsEngineDataset,
} from "../src/analytics/analytics-engine.ts";
import type { ClickEvent, SaleEvent } from "../src/schema.ts";

type DataPoint = Parameters<AnalyticsEngineDataset["writeDataPoint"]>[0];

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
  referrerHost: "t.co",
  country: "US",
  continent: "NA",
  utm: { source: "x", campaign: "spring" },
  variant: "b",
  visitor: "v1",
  bot: true,
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
  currency: "EUR",
};

describe("analytics engine sink (mocked)", () => {
  test("ingest writes one data point per event with the documented layout", async () => {
    const points: DataPoint[] = [];
    const sink = createAnalyticsEngine({
      dataset: { writeDataPoint: (p) => void points.push(p) },
      datasetName: "links_events",
    });
    await sink.ingest([click, sale]);
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual({
      indexes: ["acme"],
      blobs: [
        "click",
        "clk_1",
        "lnk_1",
        "go.acme.com",
        "launch",
        "US",
        "NA",
        "(none)",
        "mobile",
        "iOS",
        "Safari",
        "t.co",
        "x",
        "(none)",
        "spring",
        "true",
        "b",
        "v1",
        "",
        JSON.stringify(click),
      ],
      doubles: [Date.parse(click.at), 1, 0],
    });
    expect(points[1]!.blobs!.slice(5, 19)).toEqual([
      ...Array<string>(11).fill("(none)"),
      "(none)",
      "",
      "EUR",
    ]);
    expect(points[1]!.doubles).toEqual([Date.parse(sale.at), 0, 4999]);
  });

  test("oversized events drop metadata to stay under the 16 KB blob limit", () => {
    const big: SaleEvent = { ...sale, metadata: { blob: "x".repeat(20_000) } };
    const point = toDataPoint(big);
    const json = JSON.parse(point.blobs[19]!);
    expect(json.metadata).toBeUndefined();
    expect(json.amount).toBe(4999);
    const bytes = point.blobs.reduce((n, b) => n + new TextEncoder().encode(b).length, 0);
    expect(bytes).toBeLessThanOrEqual(16 * 1024);
    expect(JSON.parse(toDataPoint({ ...sale, metadata: { a: 1 } }).blobs[19]!).metadata).toEqual({
      a: 1,
    });
  });

  test("query uses _sample_interval weights over the SQL API", async () => {
    const { fetch, calls } = mockFetch((req) =>
      req.body.includes("AS t,")
        ? {
            data: [
              {
                t: Date.parse("2026-03-10T12:00:00Z"),
                clicks: 20,
                bot_clicks: 0,
                leads: 1,
                sales: 1,
                sale_amount: 4999,
              },
            ],
          }
        : { data: [{ clicks: 20, bot_clicks: 0, leads: 1, sales: 1, sale_amount: 4999 }] },
    );
    const sink = createAnalyticsEngine({
      accountId: "acc 1",
      apiToken: "cf_token",
      datasetName: "links_events",
      fetch,
    });
    const result = await sink.query({
      tenant: "ac'me",
      from: "2026-03-10T12:00:00Z",
      to: "2026-03-10T14:00:00Z",
      linkIds: ["lnk_1"],
      interval: "hour",
    });
    expect(calls).toHaveLength(2);
    const [req] = calls;
    expect(req!.url.toString()).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acc%201/analytics_engine/sql",
    );
    expect((req!.init.headers as Record<string, string>).Authorization).toBe("Bearer cf_token");
    expect(req!.body).toContain(
      "SUM(if(blob1 = 'click' AND NOT (double2 = 1), _sample_interval, 0)) AS clicks",
    );
    expect(req!.body).toContain(
      "SUM(if(blob1 = 'sale', double3 * _sample_interval, 0)) AS sale_amount",
    );
    expect(req!.body).toContain("FROM links_events WHERE index1 = 'ac\\'me'");
    expect(req!.body).toContain(`double1 >= ${Date.parse("2026-03-10T12:00:00Z")}`);
    expect(req!.body).toContain("blob3 IN ('lnk_1')");
    expect(req!.body).not.toContain("uniq");
    expect(calls[1]!.body).toContain("intDiv(double1, 3600000) * 3600000 AS t");
    expect(result.totals).toEqual({
      clicks: 20,
      botClicks: 0,
      leads: 1,
      sales: 1,
      saleAmount: 4999,
    });
    expect(result.timeseries!.map((b) => b.clicks)).toEqual([20, 0]);
    expect(result.timeseries![0]!.uniques).toBeUndefined();
  });

  test("events() reads blob20 newest first", async () => {
    const { fetch, calls } = mockFetch(() => ({ data: [{ data: JSON.stringify(sale) }] }));
    const sink = createAnalyticsEngine({ accountId: "a", apiToken: "t", datasetName: "ds", fetch });
    expect(await sink.events({ tenant: "acme", types: ["sale"], limit: 10 })).toEqual([sale]);
    expect(calls[0]!.body).toBe(
      "SELECT blob20 AS data FROM ds WHERE index1 = 'acme' AND blob1 IN ('sale') AND NOT (double2 = 1) " +
        "ORDER BY double1 DESC, blob2 DESC LIMIT 10 FORMAT JSON",
    );
  });

  test("capabilities: no uniques, no deleteLink", () => {
    const sink = createAnalyticsEngine({ datasetName: "ds" });
    expect(sink.capabilities).toEqual({
      crossFilter: true,
      uniques: false,
      events: true,
      intervals: ["hour", "day"],
    });
    expect("deleteLink" in sink).toBe(false);
  });

  test("missing halves fail clearly", async () => {
    const sink = createAnalyticsEngine({ datasetName: "ds" });
    await expect(sink.ingest([click])).rejects.toThrow(/needs the `dataset` binding/);
    await expect(sink.ingest([])).resolves.toBeUndefined();
    await expect(sink.query({ tenant: "a", from: click.at, to: sale.at })).rejects.toThrow(
      /need `accountId` and `apiToken`/,
    );
    expect(() => createAnalyticsEngine({ datasetName: "bad name" })).toThrow(/Invalid datasetName/);
  });

  test("SQL API errors carry the status", async () => {
    const { fetch } = mockFetch(() => new Response("unsupported", { status: 422 }));
    const sink = createAnalyticsEngine({ accountId: "a", apiToken: "t", datasetName: "ds", fetch });
    await expect(sink.events({ tenant: "a" })).rejects.toThrow(
      /Analytics Engine query failed \(422\)/,
    );
  });
});

// With CLICKHOUSE_URL set, emulate a dataset (index1, blob1..20, double1..3,
// _sample_interval) in a live ClickHouse and run the full suite against the
// generated SQL.
const ch = liveClickHouse();
if (ch) {
  const table = ch.uniqueName("links_ae_test");
  const pending: DataPoint[] = [];
  const dataset: AnalyticsEngineDataset = { writeDataPoint: (p) => void pending.push(p) };
  const flush = async () => {
    const points = pending.splice(0);
    if (points.length === 0) return;
    const rows = points.map((p) => {
      const row: Record<string, unknown> = { index1: p!.indexes![0], _sample_interval: 1 };
      p!.blobs!.forEach((b, i) => (row[`blob${i + 1}`] = b));
      p!.doubles!.forEach((d, i) => (row[`double${i + 1}`] = d));
      return JSON.stringify(row);
    });
    const response = await ch.run(`INSERT INTO ${table} FORMAT JSONEachRow`, rows.join("\n"));
    if (!response.ok) throw new Error(await response.text());
  };
  const sqlOverClickHouse = (async (_input: RequestInfo | URL, init: RequestInit = {}) =>
    ch.run(String(init.body))) as typeof fetch;

  beforeAll(async () => {
    const blobs = Array.from({ length: 20 }, (_, i) => `blob${i + 1} String`).join(", ");
    await ch.run(
      `CREATE TABLE ${table} (index1 String, ${blobs}, double1 Float64, double2 Float64, ` +
        `double3 Float64, _sample_interval UInt32) ENGINE = MergeTree ORDER BY (index1, double1)`,
    );
  }, 30_000);
  afterAll(async () => {
    await ch.run(`DROP TABLE IF EXISTS ${table}`);
  }, 30_000);
  const sink = createAnalyticsEngine({
    dataset,
    accountId: "acc",
    apiToken: "t",
    datasetName: table,
    fetch: sqlOverClickHouse,
  });
  runAnalyticsContractTests("analytics engine SQL over ClickHouse (live)", () => sink, {
    settle: flush,
    timeout: 30_000,
  });
}
