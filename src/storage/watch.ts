/**
 * Composable change-notifications. `watch` is **orthogonal** to which storage
 * you use, so rather than bake it into each adapter, {@link withWatch} wraps
 * *any* {@link LinksStorage} with a {@link WatchSubscribe} source you provide
 * — Postgres `LISTEN`/`NOTIFY`, Redis pub/sub, an ORM after-write hook, a
 * websocket, an `EventEmitter`, etc.
 *
 * This gives `watch` to adapters that don't implement it themselves (postgres,
 * drizzle, mongodb, unstorage, cloudflare-kv, …), driven by whatever change
 * signal your infrastructure already has. Both helpers come from
 * `@xtandard/kit/storage`; {@link pgListenNotify} keeps the links default
 * channel `"xtandard_links"`.
 *
 * @example
 * ```ts
 * import { withWatch } from "@xtandard/links";
 * import { createDrizzleStorage } from "@xtandard/links/storage/drizzle";
 *
 * const storage = withWatch(createDrizzleStorage({ db, table }), (notify) => {
 *   const sub = redis.subscribe("links-changes", (m) => notify(m.key));
 *   return () => sub.unsubscribe();
 * });
 * ```
 *
 * @module
 */

import {
  pgListenNotify as kitPgListenNotify,
  type PgNotificationClient,
  type WatchSubscribe,
} from "@xtandard/kit/storage";

export { withWatch, type PgNotificationClient, type WatchSubscribe } from "@xtandard/kit/storage";

/**
 * A {@link WatchSubscribe} backed by Postgres `LISTEN`/`NOTIFY`. Pair with
 * {@link withWatch} for the postgres or drizzle-over-pg adapters. Your migration
 * owns the trigger that `pg_notify`s `channel` with the changed key as payload;
 * this only `LISTEN`s. `client` must be a dedicated `pg` `Client` (not a `Pool`).
 *
 * @example
 * ```ts
 * import { Client } from "pg";
 * const listener = new Client({ connectionString: process.env.DATABASE_URL });
 * await listener.connect();
 * const storage = withWatch(base, pgListenNotify(listener, "xtandard_links"));
 * ```
 */
export function pgListenNotify(
  client: PgNotificationClient,
  channel = "xtandard_links",
): WatchSubscribe {
  return kitPgListenNotify(client, channel);
}
