# CLI

`xtandard-links` runs the panel and redirects without code, and manages links, domains, imports,
exports, stats and QR codes from the shell, CI or a migration script. It operates on the same
storage your app uses, configured by environment variables.

```sh
npx @xtandard/links <command>      # or: bunx @xtandard/links <command>
npm i -g @xtandard/links && xtandard-links <command>
```

`xtandard-links --help` prints everything below; `--version` prints the version.

## Storage

Every command builds its storage from the environment (the same variables as the
[Docker image](DEPLOYMENT.md#standalone-cli-and-docker)):

| `STORAGE_DRIVER` | Configured by                                                              |
| ---------------- | -------------------------------------------------------------------------- |
| `file` (default) | `STORAGE_FILE_DIR` (default `./.links/storage`)                            |
| `sqlite`         | `STORAGE_SQLITE_PATH` (default `./.links/links.sqlite`); Bun only (`bunx`) |
| `postgres`       | `DATABASE_URL` or `POSTGRES_URL`, `STORAGE_PG_TABLE`                       |
| `redis`          | `REDIS_URL`, `STORAGE_PREFIX` (default `xtandard:links`)                   |
| `mongodb`        | `MONGO_URL`, `MONGO_DB`, `STORAGE_MONGO_COLLECTION`                        |
| `libsql`         | `LIBSQL_URL` or `STORAGE_LIBSQL_URL`, `LIBSQL_AUTH_TOKEN`                  |
| `memory`         | nothing persists: only useful within `serve`                               |

`DEFAULT_DOMAIN` is the shared domain for links that name none (registered on first use), and
`TENANT` the default tenant (otherwise `default`). Every command takes `--tenant` / `-t <key>`.

Bun loads `.env` automatically under `bunx`; with `npx`, export the variables or use
`node --env-file`.

## `serve`

```sh
xtandard-links serve [--port 3000] [--base-path /links] [--domain localhost]
```

The admin panel at `--base-path` (`BASE_PATH`, default `/links`; `/` redirects there) and the
redirect handler on every other path, on one port, under Bun (`bunx`) or Node (`npx`).
`--domain` (`DEFAULT_DOMAIN`, default `localhost`) is registered as the shared default domain.
Authentication, viewer tokens, `READONLY`, `TITLE`, `LOGO_URL`, `REDIRECT_BASE_PATH` and
`VISITOR_SALT` (the shared visitor-hash salt: set it when running several instances) come from the
environment ([Deployment](DEPLOYMENT.md#standalone-cli-and-docker)); with `AUTH_MODE=none` (the
default) it prints a warning: do not expose that publicly. `GET /healthcheck` answers
`{ status, title, version }`.

## `links`

```sh
xtandard-links links create --url https://acme.com/pricing --slug pricing --tag launch,q4 --title "Pricing"
xtandard-links links create https://acme.com/pricing        # the URL may be positional; slug generated
xtandard-links links list [--search q] [--tag t] [--domain host] [--archived true|all] [--limit 100] [--json]
xtandard-links links get pricing                             # id, slug, or domain/slug → JSON
xtandard-links links delete go.acme.com/pricing              # alias: rm
```

`create` prints the short URL (plus the link as JSON with `--json`) and takes `--domain`. `get`,
`delete` (and `stats --link`, `qr`) find a link by id, by `domain/slug`, or by slug on `--domain` /
the default domain. Mutations are recorded in the audit log with the actor `cli`.

With no domain registered and no `DEFAULT_DOMAIN`, `create` fails: run `domains add … --default`
first (or `serve` once, which registers `localhost`).

## `domains`

```sh
xtandard-links domains add go.acme.com --default --root-url https://acme.com --not-found-url https://acme.com/404
xtandard-links domains add links.customer.com --tenant customer-42 --default
xtandard-links domains list [--tenant customer-42]   # ★ marks defaults
xtandard-links domains remove go.acme.com [--force]  # --force also deletes its links
```

## `import` and `export`

```sh
xtandard-links import bitly-export.csv --format bitly --tenant acme --dry-run
xtandard-links import links.csv [--format auto|native|bitly|dub|shlink|kutt] \
  [--on-conflict skip|update|error] [--domain go.acme.com] [--keep-domains] [--tag imported]
xtandard-links export -o links.csv                   # native CSV, every link incl. archived
```

`import` parses the CSV ([formats](LINKS.md#import-and-export)), then imports into the tenant:
`--dry-run` validates and classifies without writing, `--on-conflict` (default `skip`) decides what
happens when a row's external id or slug exists, `--domain` puts every row on one domain,
`--keep-domains` keeps the source domains of a foreign export, `--tag` adds tags to every row.
Errors are printed per CSV row (`row 7: link.url: must be an absolute URL`); the exit code is `2`
when any row failed. `export` writes the `native` format (re-importable, never passwords) to `-o`
or stdout.

## `stats`

```sh
xtandard-links stats acme --days 30
xtandard-links stats acme --link pricing --days 7
```

Clicks, bot clicks, leads, sales and revenue for the period, a daily bar chart, and the top
countries, referrers and devices (breakdowns the analytics sink cannot answer are skipped). The
tenant is the first argument (or `--tenant`).

## `qr`

```sh
xtandard-links qr pricing -o pricing.svg             # a link: encodes its short URL + ?qr=1
xtandard-links qr https://acme.com/menu --size 1024  # any URL, to stdout
```

SVG, 512 px by default. For a link, the code encodes the short URL with `?qr=1`, so scans are
counted as QR clicks ([Links](LINKS.md#qr-codes)).

## `prune`

```sh
xtandard-links prune
```

Deletes click refs older than the attribution window and expired or claimed deferred deep-link
handoffs (`core.prune()`), and, with the default KV analytics sink, hourly and daily buckets past
their retention plus the excess of the recent-events log (`analytics.prune()`,
[Analytics](ANALYTICS.md#kv-rollups-default)). Run it from cron against your production storage.

## Exit codes

`0` success, `1` usage error or failure (the message goes to stderr), `2` an import with failed
rows.
