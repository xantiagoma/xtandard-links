import { runStorageContractTests } from "./storage-contract.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";

runStorageContractTests("memory", () => createMemoryStorage(), {
  compareAndSwap: true,
  watch: { settleMs: 5 },
});
