/**
 * Storage conformance for the links drivers: the shared
 * `@xtandard/kit/storage/testing` suite (run with the `lnk` key root), plus the
 * links key-layout cases (URI-encoded slugs and tenants).
 *
 * This file deliberately omits the `.test.ts` suffix so vitest does not pick it
 * up as a standalone suite — it only runs when imported by an adapter's test,
 * which injects its runner (`vitest` or `bun:test`).
 *
 * @module
 */

import {
  runConformanceCases,
  runStorageConformance,
  type ConformanceCapabilities,
  type ConformanceCase,
  type ConformanceTestApi,
  type SeedLegacy,
} from "@xtandard/kit/storage/testing";
import { linkKey, linksPrefix, ROOT, slugKey } from "../src/keys.ts";
import type { LinksStorage } from "../src/storage/contract.ts";

/** A factory producing a fresh, empty storage for each test. */
export type MakeStorage = () => Promise<LinksStorage> | LinksStorage;

/** What a backend opts into. */
export interface StorageContractOptions {
  /** The injected test API (`{ describe, test, expect }` from vitest or bun:test). */
  t: ConformanceTestApi;
  /** Capabilities for the kit suite — declare every one (`false` for what the driver lacks). */
  capabilities: ConformanceCapabilities;
  /** Write a non-canonical stored form directly (the kit's legacy-CAS case). */
  seedLegacy?: SeedLegacy;
  /** Per-test timeout (live backends). */
  timeout?: number;
}

/** The links key layout on any backend. */
export const keyLayoutCases: ConformanceCase[] = [
  {
    name: "slug keys with encoded characters (nested slugs, unicode) round-trip and list",
    async run({ storage, expect }) {
      const k1 = slugKey("go.acme.com", "docs/intro");
      const k2 = slugKey("go.acme.com", "café-50%");
      await storage.setItem(k1, { tenant: "acme", id: "lnk_1" });
      await storage.setItem(k2, { tenant: "acme", id: "lnk_2" });
      expect(await storage.getItem(k1)).toEqual({ tenant: "acme", id: "lnk_1" });
      expect(await storage.getItem(k2)).toEqual({ tenant: "acme", id: "lnk_2" });
      expect((await storage.getKeys("lnk/s/go.acme.com/")).sort()).toEqual([k1, k2].sort());
    },
  },
  {
    name: "case-distinct tenants do not collide",
    async run({ storage, expect }) {
      for (const t of ["Acme", "acme", "ACME"]) {
        await storage.setItem(linkKey(t, "lnk_1"), { t });
        await storage.setItem(`lnk/tenants/${t}`, t);
      }
      for (const t of ["Acme", "acme", "ACME"]) {
        expect(await storage.getItem(linkKey(t, "lnk_1"))).toEqual({ t });
        expect(await storage.getKeys(linksPrefix(t))).toEqual([linkKey(t, "lnk_1")]);
      }
      expect((await storage.getKeys("lnk/tenants/")).sort()).toEqual([
        "lnk/tenants/ACME",
        "lnk/tenants/Acme",
        "lnk/tenants/acme",
      ]);
    },
  },
];

/**
 * Run the kit conformance suite (key root `lnk`) against a links driver, plus
 * the links key-layout cases.
 */
export function runStorageContractTests(
  name: string,
  makeStorage: MakeStorage,
  options: StorageContractOptions,
): void {
  const shared = { t: options.t, keyRoot: ROOT, timeout: options.timeout };
  runStorageConformance(name, makeStorage, {
    ...shared,
    capabilities: options.capabilities,
    seedLegacy: options.seedLegacy,
  });
  runConformanceCases(`links key layout: ${name}`, keyLayoutCases, makeStorage, shared);
}
