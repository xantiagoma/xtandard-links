import { describe, expect, test } from "vitest";
import { runAnalyticsContractTests } from "./analytics-contract.ts";
import { createMemoryAnalytics } from "../src/analytics/memory.ts";
import type { ClickEvent } from "../src/schema.ts";

runAnalyticsContractTests("memory", () => createMemoryAnalytics());

describe("memory analytics extras", () => {
  const event: ClickEvent = {
    type: "click",
    id: "c1",
    at: "2026-01-01T00:00:00.000Z",
    tenant: "t",
    linkId: "lnk_1",
    domain: "go.example.com",
    slug: "a",
    destination: "https://example.com",
    device: "desktop",
    os: "macOS",
    browser: "Chrome",
    referrerHost: "(direct)",
    bot: false,
    qr: false,
  };

  test("stores copies, not references", async () => {
    const sink = createMemoryAnalytics();
    const mine = structuredClone(event);
    await sink.ingest([mine]);
    mine.country = "US";
    const [stored] = await sink.events({ tenant: "t" });
    expect(stored!.type === "click" && stored!.country).toBeUndefined();
    stored!.linkId = "mutated";
    expect(sink.all()[0]!.linkId).toBe("lnk_1");
  });

  test("clear() empties the sink", async () => {
    const sink = createMemoryAnalytics();
    await sink.ingest([event]);
    expect(sink.all()).toHaveLength(1);
    sink.clear();
    expect(sink.all()).toEqual([]);
  });
});
