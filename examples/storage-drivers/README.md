# storage-drivers × @xtandard/links

One four-method KV contract, every backend. The script runs the identical loop on
each driver — create a link, click it twice through the redirect handler, flush,
then read the link back, the hourly rollup and the click counter — and checks the
numbers.

| Driver   | Import                             | Runs when                            |
| -------- | ---------------------------------- | ------------------------------------ |
| memory   | `@xtandard/links/storage/memory`   | always                               |
| file     | `@xtandard/links/storage/file`     | always (temp dir)                    |
| sqlite   | `@xtandard/links/storage/sqlite`   | always (`bun:sqlite`, in memory)     |
| redis    | `@xtandard/links/storage/redis`    | `REDIS_URL`                          |
| postgres | `@xtandard/links/storage/postgres` | `DATABASE_URL`                       |
| mongodb  | `@xtandard/links/storage/mongodb`  | `MONGO_URL`                          |
| libsql   | `@xtandard/links/storage/libsql`   | `LIBSQL_URL` (+ `LIBSQL_AUTH_TOKEN`) |

Also available: `storage/drizzle` (reuse your app's Drizzle database),
`storage/unstorage` (Upstash, S3, Vercel KV, …) and `storage/cloudflare-kv` (see
[`../cloudflare-workers`](../cloudflare-workers)).

## Run it

```bash
# from the repo root (build once first: bun run build)
bun run examples:storage-drivers

# or in this directory
bun install
REDIS_URL=redis://localhost:6379 bun run start
```

```
✓ memory    /aB3xK9q → 302, 2 clicks rolled up, counter=2 (6 ms)
✓ file      /Zp81LmQ → 302, 2 clicks rolled up, counter=2 (21 ms)
✓ sqlite    /k2PqRt7 → 302, 2 clicks rolled up, counter=2 (4 ms)
(set REDIS_URL / DATABASE_URL / MONGO_URL / LIBSQL_URL to include more backends)
```

Each run uses a throwaway tenant and deletes it afterwards (rollup buckets for
that tenant stay behind), so pointing it at a shared database is safe.
