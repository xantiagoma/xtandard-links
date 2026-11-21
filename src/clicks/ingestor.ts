/**
 * The click ingestor (ADR 0007): `capture()` enqueues synchronously and
 * returns; batches flush to the {@link AnalyticsSink} on size or interval with
 * bounded exponential retry. The redirect never waits on the sink.
 *
 * @module
 */

import type { AnalyticsSink } from "../analytics/contract.ts";
import type { AnalyticsEvent } from "../schema.ts";

/** Something that keeps a background promise alive (Workers / Vercel `waitUntil`). */
export type WaitUntil = (promise: Promise<unknown>) => void;

/** Options for {@link createClickIngestor}. */
export interface ClickIngestorOptions {
  sink: AnalyticsSink;
  /** Flush when this many events are queued. Default 100. */
  batchSize?: number;
  /** Flush at least this often (ms). Default 1000. `0` disables the timer (manual / edge mode). */
  flushIntervalMs?: number;
  /** Max queued events; past it the oldest are dropped (and `onDrop` fires). Default 10 000. */
  maxQueue?: number;
  /** Retry attempts per batch after the first failure. Default 3. */
  retries?: number;
  /** Base backoff (ms), doubled per retry. Default 200. */
  retryBaseMs?: number;
  /** Called when a batch fails for good (after retries). The events are dropped. */
  onError?: (error: unknown, events: readonly AnalyticsEvent[]) => void;
  /** Called with events dropped because the queue overflowed. */
  onDrop?: (events: readonly AnalyticsEvent[]) => void;
}

/** A running ingestor. */
export interface ClickIngestor {
  /**
   * Enqueue an event. Never throws, never awaits the sink. With `waitUntil`
   * (edge runtimes), the queue is flushed in the background immediately.
   */
  capture(event: AnalyticsEvent, options?: { waitUntil?: WaitUntil }): void;
  /** Flush everything queued now. Resolves when the sink acknowledged (or gave up). */
  flush(): Promise<void>;
  /** Flush and stop the timer. */
  close(): Promise<void>;
  /** Events waiting to be flushed. */
  readonly pending: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const defaultOnError = (error: unknown, events: readonly AnalyticsEvent[]) => {
  console.warn(`[@xtandard/links] analytics sink rejected ${events.length} event(s):`, error);
};

/**
 * Create a batching ingestor in front of an analytics sink.
 *
 * @example
 * ```ts
 * const ingestor = createClickIngestor({ sink: createKvAnalytics({ storage }) });
 * ingestor.capture(clickEvent);
 * await ingestor.close(); // graceful shutdown
 * ```
 */
export function createClickIngestor(options: ClickIngestorOptions): ClickIngestor {
  const batchSize = Math.max(1, options.batchSize ?? 100);
  const flushIntervalMs = options.flushIntervalMs ?? 1000;
  const maxQueue = Math.max(batchSize, options.maxQueue ?? 10_000);
  const retries = options.retries ?? 3;
  const retryBaseMs = options.retryBaseMs ?? 200;
  const onError = options.onError ?? defaultOnError;

  let queue: AnalyticsEvent[] = [];
  let inFlight: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  async function sendBatch(batch: AnalyticsEvent[]): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await options.sink.ingest(batch);
        return;
      } catch (error) {
        if (attempt >= retries) {
          try {
            onError(error, batch);
          } catch {
            // reporter errors are never propagated
          }
          return;
        }
        await sleep(retryBaseMs * 2 ** attempt);
      }
    }
  }

  function drain(): Promise<void> {
    // Serialize flushes so batches reach the sink in capture order.
    inFlight = inFlight.then(async () => {
      while (queue.length > 0) {
        const batch = queue.slice(0, batchSize);
        queue = queue.slice(batch.length);
        await sendBatch(batch);
      }
    });
    return inFlight;
  }

  function ensureTimer(): void {
    if (timer || closed || flushIntervalMs <= 0) return;
    timer = setInterval(() => {
      if (queue.length > 0) void drain();
    }, flushIntervalMs);
    // Never keep a Node/Bun process alive just for analytics.
    (timer as { unref?: () => void }).unref?.();
  }

  return {
    capture(event, captureOptions) {
      try {
        queue.push(event);
        if (queue.length > maxQueue) {
          const dropped = queue.splice(0, queue.length - maxQueue);
          try {
            options.onDrop?.(dropped);
          } catch {
            // ignore
          }
        }
        if (captureOptions?.waitUntil) {
          captureOptions.waitUntil(drain());
        } else if (queue.length >= batchSize) {
          void drain();
        } else {
          ensureTimer();
        }
      } catch {
        // capture never throws into the redirect path
      }
    },
    flush: () => drain(),
    async close() {
      closed = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      await drain();
      await options.sink.close?.();
    },
    get pending() {
      return queue.length;
    },
  };
}
