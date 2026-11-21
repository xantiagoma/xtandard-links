/**
 * The default analytics sink: time-bucket rollups in the links storage itself
 * (zero extra infrastructure). `createLinksCore` uses it when no `analytics` is
 * passed; import it to tune retention.
 *
 * Import from `@xtandard/links/analytics/kv`.
 *
 * @module analytics/kv
 */

export * from "./analytics/kv.ts";
