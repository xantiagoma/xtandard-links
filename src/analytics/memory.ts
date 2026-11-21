/**
 * In-memory analytics sink. Zero dependencies; for tests, demos and
 * development. Aggregation is exactly {@link aggregateEvents} (the reference
 * semantics every sink must reproduce), plus exact unique visitors.
 *
 * @module
 */

import type { AnalyticsEvent } from "../schema.ts";
import {
  aggregateEvents,
  bucketStart,
  dimensionValue,
  matchesQuery,
  type AnalyticsCapabilities,
  type AnalyticsQuery,
  type AnalyticsResult,
  type AnalyticsSink,
  type EventsQuery,
} from "./contract.ts";

/** The memory sink: an {@link AnalyticsSink} with every optional method plus test helpers. */
export interface MemoryAnalyticsSink extends AnalyticsSink {
  events(query: EventsQuery): Promise<AnalyticsEvent[]>;
  deleteLink(tenant: string, linkId: string): Promise<void>;
  /** Every stored event in ingestion order (copies). */
  all(): AnalyticsEvent[];
  /** Drop every stored event. */
  clear(): void;
}

const clone = <T>(value: T): T => structuredClone(value);

/** The visitor counted toward `uniques`: non-bot clicks that carry a visitor hash. */
export function uniqueVisitor(event: AnalyticsEvent): string | undefined {
  return event.type === "click" && !event.bot && event.visitor ? event.visitor : undefined;
}

/** Newest first: `at` descending, then `id` descending. */
export function compareEventsNewestFirst(a: AnalyticsEvent, b: AnalyticsEvent): number {
  return Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/**
 * Create an in-memory {@link AnalyticsSink}.
 *
 * @example
 * ```ts
 * import { createMemoryAnalytics } from "@xtandard/links/analytics/memory";
 *
 * const analytics = createMemoryAnalytics();
 * ```
 */
export function createMemoryAnalytics(): MemoryAnalyticsSink {
  let stored: AnalyticsEvent[] = [];

  const capabilities: AnalyticsCapabilities = {
    crossFilter: true,
    uniques: true,
    events: true,
    intervals: ["hour", "day"],
  };

  return {
    capabilities,

    async ingest(events) {
      for (const event of events) stored.push(clone(event));
    },

    async query(query: AnalyticsQuery): Promise<AnalyticsResult> {
      const result = aggregateEvents(stored, query);

      const totals = new Set<string>();
      const buckets = new Map<number, Set<string>>();
      const groups = new Map<string, Set<string>>();
      const add = <K>(map: Map<K, Set<string>>, key: K, visitor: string) => {
        let set = map.get(key);
        if (!set) map.set(key, (set = new Set()));
        set.add(visitor);
      };
      for (const event of stored) {
        const visitor = uniqueVisitor(event);
        if (visitor === undefined || !matchesQuery(event, query)) continue;
        totals.add(visitor);
        if (query.interval)
          add(buckets, bucketStart(Date.parse(event.at), query.interval), visitor);
        if (query.groupBy) add(groups, dimensionValue(event, query.groupBy), visitor);
      }

      result.totals.uniques = totals.size;
      for (const bucket of result.timeseries ?? []) {
        bucket.uniques = buckets.get(Date.parse(bucket.at))?.size ?? 0;
      }
      for (const row of result.breakdown ?? []) row.uniques = groups.get(row.key)?.size ?? 0;
      return result;
    },

    async events(query: EventsQuery): Promise<AnalyticsEvent[]> {
      const before = query.before === undefined ? Infinity : Date.parse(query.before);
      const limit = query.limit ?? 50;
      return stored
        .filter(
          (e) =>
            e.tenant === query.tenant &&
            Date.parse(e.at) < before &&
            (!query.linkIds || query.linkIds.includes(e.linkId)) &&
            (!query.types || query.types.includes(e.type)) &&
            (query.includeBots || e.type !== "click" || !e.bot),
        )
        .sort(compareEventsNewestFirst)
        .slice(0, Math.max(0, limit))
        .map(clone);
    },

    async deleteLink(tenant, linkId) {
      stored = stored.filter((e) => e.tenant !== tenant || e.linkId !== linkId);
    },

    all: () => stored.map(clone),

    clear() {
      stored = [];
    },
  };
}
