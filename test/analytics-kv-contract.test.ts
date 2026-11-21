import { createKvAnalytics } from "../src/analytics/kv.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";
import { runAnalyticsContractTests } from "./analytics-contract.ts";

runAnalyticsContractTests(
  "kv (memory storage)",
  () => createKvAnalytics({ storage: createMemoryStorage() }),
  { granularity: "hour" },
);
