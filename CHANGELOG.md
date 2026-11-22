# Changelog

## v0.2.0

[compare changes](https://github.com/xantiagoma/xtandard-links/compare/v0.1.2...v0.2.0)

### Changed

- **`@xtandard/kit` is now a dependency.** The storage drivers, drizzle table factories, auth and
  authorization providers, the hooks runner, ids/durations/validation core, viewer-token
  mechanics, the panel and API plumbing, the framework adapters, the CLI plumbing, the admin
  shell's primitives/theme/API client, the React embed plumbing, the build configs, the docs-site
  tooling and the CI/release workflows come from `@xtandard/kit`. Every subpath and exported name
  of `@xtandard/links` is unchanged (API-surface diff: 6 added, 0 removed); users never install or
  configure the kit. The redirect handler, resolver, rules, click ingestion, analytics sinks
  (KV rollups, memory, ClickHouse, Tinybird, Analytics Engine), the approximate click counter,
  conversions, deep links, import/export and the views stay in links.
- **Every SQL, document, Redis, memory and file adapter has `compareAndSwap`**, including Drizzle on
  MySQL (it had none) and the file driver (serialized within one process). Only unstorage and
  Cloudflare KV lack it. Comparisons are structural (object key order and own properties).
- **Values are written as canonical JSON** (sorted object keys) by every adapter. Data written by
  earlier releases reads, lists and swaps as before (a swap against a row stored in another key
  order falls back to a structural compare on the raw stored value); no migration.
- **unstorage writes string values JSON-encoded** (`"hello"` is stored as `"\"hello\""`), so a
  stored `"123"` reads back as a string. Strings stored by earlier releases read back as before.
- **`pgLinksTable` takes `keyCollation`** (default `null`: the plain `text` key of every earlier
  release, so drizzle-kit sees no diff; `"C"` for bytewise, index-usable prefixes on new tables).
  **`mysqlLinksTable` takes `keyCollation`** (`utf8mb4_bin` by default; `utf8mb4_0900_bin` on MySQL
  8.0+ or `utf8mb4_nopad_bin` on MariaDB for new tables). See "MySQL PAD SPACE" under Fixed.
- **`createSqliteStorage` creates its table on first use** (it was created in the constructor).
- **`createDrizzleStorage` detects the dialect from `db`** (a real Drizzle database always carries
  it); a `db` without one now throws at construction and takes `dialect: "pg" | "mysql" | "sqlite"`.
  `DrizzleLinksStorage` now always includes `compareAndSwap`.
- **`createPostgresStorage(options?)`**: the options are optional (every field already was).
- **Storage error messages** name the links import path:
  `@xtandard/links/storage/mongodb requires either a \`client\` or a \`url\``, and a missing peer
  says `@xtandard/links/storage/redis requires the optional peer "redis"…`.
- **`createFetchHandler`** and every adapter helper (`linksPanel` for Bun, Hono, Express, Elysia;
  `linksRouteHandlers` for Next) gain `close()` (idempotent; the links panel runs no background
  work). `/healthcheck` keeps its `{ status, version }` body.
- **A non-GET request outside the API** gets `405` with `Allow: GET, HEAD`; a wrong method on an
  API route gets `405` with the route's `Allow` methods.
- **Viewer tokens:** `createViewerToken` / `verifyViewerToken` accept a list of secrets (rotation:
  the first signs, any verifies). The `lvt_` wire format, the 1-day default, the claims and the
  error messages are unchanged. `ViewerTokenError` is the kit's per-instance error class (same
  `name`, `instanceof` still works).
- **Validation:** `ValidationError`, `ValidationIssue`, `ValidationResult` and `assertValid` are the
  kit's (same shape; `ValidationError` also has an `issues` alias of `errors`). An unknown field in
  a strict input now reads `"unknown field"` instead of valibot's `Invalid key: Expected never but
  received "x"`. A malformed duration's message reads `(expected e.g. "30s", "5m", "14d")`, and
  durations also accept weeks (`"2w"`).
- **CLI:**
  - `AUTH_ROLE` sets the basic-auth user's role (`admin` by default, as before).
  - `STORAGE_SQLITE_TABLE` names the `sqlite`/`libsql` table (default `xtandard_links_kv`, as
    before).
  - Boolean flags (`--dry-run`, `--keep-domains`, `--json`, `--default`, `--force`, `--help`,
    `--version`) never take the next argument as their value, and a value starting with `-` is no
    longer taken as a flag's value (`-o -` still prints to stdout).
  - `bun src/cli.ts <command>` runs the CLI directly (a self-run guard); importing the module never
    runs it.
- **Admin UI:** the primitives, toasts, theme toggle and API client are the kit's;
  `LinksApiError` extends the kit's `ApiError` and its `body.status` always carries the HTTP
  status. The stylesheet imports the kit's (which imports Tailwind) and keeps the links brand
  tokens.
- **React embed:** `@xtandard/links/react` also exports the `FetchLike` type; `LinkAnalytics` still
  routes in memory by default.
- **New exports (additions only):** `FileLinksStorage`, `FileLegacyMode` and `migrateFileStorage`
  (`./storage/file`); `KeyCollisionError` (`./storage/drizzle`).
- **Docs site, CI and release** run on the kit's tooling and reusable workflows (`@v0.1`). CI uses
  `redis:8`, so the RedisJSON conformance cases run (the live suite reads `REDIS_JSON_URL`, was
  `REDIS_STACK_URL`). The Docker image is smoke-tested (`/healthcheck`, `/links/`, the OpenAPI
  document) before it is pushed, and `docker.yml` has a `refresh-kit` dispatch input. The release is
  prepared by the kit (gate, build, publint, pack, notes) and published from links' `release.yml`.

### Fixed

Inherited from `@xtandard/kit` (inventory §3; each has a permanent regression test in the kit).

#### Storage

- **MySQL PAD SPACE (inventory §5):** on a `utf8mb4_bin` key column, `"a "` and `"a"` are the same
  primary key. The Drizzle MySQL driver now compares keys byte-exactly on reads, deletes and swaps,
  and turns a write that would collide into a `KeyCollisionError` instead of overwriting the other
  key. links' own keys never end in a space (every variable key segment is URI-encoded, so a space
  is stored as `%20`), so no path parameter needed re-validation; this protects keys written
  directly through the storage.
- **MySQL: `getKeys` no longer skips keys with supplementary characters (emoji).** An indexed
  `LIKE 'p%'` on `utf8mb4_bin` missed them on MySQL 8.4; prefixes are now a range scan plus an exact
  `startsWith`.
- **unstorage: a stored string that looks like JSON stays a string** (`"123"` used to read back as
  `123`).
- **Postgres / Drizzle: a stored string that looks like JSON stays a string** (the value was parsed
  a second time).
- **file: empty key segments are distinct keys** (`a//b` ≠ `a/b`), and **writes are atomic**
  (temporary file + rename), so a crash never leaves a truncated JSON file.
- **unstorage: a trailing `$` and empty segments round-trip** (unstorage hid them as meta keys or
  collapsed them); keys written by earlier releases still read.
- **Postgres / libSQL / SQLite / MongoDB: a failed connect or table DDL is retried** on the next call
  instead of being cached forever.
- **Postgres keys get `COLLATE "C"` on new tables, SQLite and libSQL prefix queries use `GLOB`, and
  Mongo prefix listings add an exact `startsWith`,** so prefixes stay exact under any collation.
- **MongoDB compare-and-swap works on values whose object keys start with `$`.**
- **Structural equality checks own properties** (`{ a: undefined }` no longer equals
  `{ b: undefined }`).
- **Redis/RedisJSON compare-and-swap tells `{}` from `[]`.**
- **`withWatch` survives an object spread** of the wrapped storage.

#### Server, CLI and adapters

- **Node 20.0–20.15 served the "UI not built" page** instead of the admin SPA
  (`process.getBuiltinModule` is missing there); the UI directory now resolves on every Node 20
  that `engines` allows (kit 0.1.1).
- **CLI values may be negative numbers or a bare `-`** (`--limit -1`), instead of being read as
  a new flag (kit 0.1.1 `parseArgs`).
- **An unknown `STORAGE_DRIVER` is an error** (the CLI and the standalone server silently fell back
  to `file`), and **an empty environment variable counts as unset**, so its default applies
  (`STORAGE_DRIVER=` used to be read as the driver name `""`).
- **The CLI's Node server streams responses** with backpressure (it buffered them), appends
  multi-value request headers one by one (it joined them into one), and keeps every `Set-Cookie`.
- **Express: the panel streams responses** with backpressure, cancels the body when the client
  disconnects, answers `HEAD` without a body, and re-serialised bodies drop a stale
  `content-length`.
- **Elysia: the pass-through drops a stale `content-length`** and rebuilds the body only when Elysia
  consumed it (`FormData` stays multipart, urlencoded objects are re-encoded).
- **A `Bearer` scheme is matched case-insensitively** for viewer tokens.
- **`src/cli.ts` runs itself only when executed directly** (au 6761a34; links lacked the guard).

#### Admin UI and embed

- **A `?token=` / `#token=` is stripped from the address bar** once the SPA has read it (it stayed
  in the URL, where it could be bookmarked, shared or sent as a `Referer`), and the fragment form is
  accepted (it never reaches servers or access logs).
- **A viewer token means the widget chrome from the first render**: no admin request (the tenants
  list) goes out before `/config` answers.
- **`LinkAnalytics` refetches only when its token actually changes**, and clears the token when it
  unmounts.

#### Tooling

- **RedisJSON conformance now runs in CI** (redis:8), and the live ClickHouse sink tests run
  against a password-protected, health-checked `clickhouse-server:24.8`.
- **The docs site** emits `og:image:alt`, serves every favicon size (`16x16 32x32 48x48`), and its
  API reference validates `apiOwners`.

### Migration

None required. Data, keys, tables, the HTTP API (status codes, error codes, `/healthcheck`,
`/config`), the viewer-token format and every export are compatible.

- If a deployment's `STORAGE_DRIVER` was misspelled, it used to run on `./.links/storage` (file);
  it now fails at startup with `Unknown STORAGE_DRIVER "…"`. Fix the value (and move any data the
  file store collected).
- `createDrizzleStorage` over an object that is not a real Drizzle database (a custom wrapper
  without its dialect) throws at construction; pass `dialect`.
- To opt into the NO PAD MySQL collation on an existing table, see the kit's storage guide for the
  `ALTER TABLE`; the default stays `utf8mb4_bin`.

## v0.1.2

[compare changes](https://github.com/xantiagoma/xtandard-links/compare/v0.1.1...v0.1.2)

Security fix for the standalone server, the CLI and the Docker image: a mistyped `AUTH_MODE` no longer serves an open panel. Library APIs, storage and the HTTP API are unchanged.

### 🩹 Fixes

- **auth:** reject unknown `AUTH_MODE` instead of serving an open panel ([#19](https://github.com/xantiagoma/xtandard-links/pull/19)). Any value other than `none` or `basic` (a typo, wrong case) used to fall through to `none`, leaving the admin panel and API unauthenticated. The server now exits with `Unknown AUTH_MODE "x" (expected none or basic)` before it listens. An empty or unset `AUTH_MODE` still means `none`, and now prints the same unauthenticated-panel warning as an explicit `none`.

### Migration

None if `AUTH_MODE` is `none`, `basic` or unset. If a deployment fails to start after upgrading, its `AUTH_MODE` was invalid and the panel was open: set it to `basic` (with credentials) or `none` explicitly.

## v0.1.1

Branding in the shipped admin UI, widget and React embeds, plus brand, docs and tooling fixes. No
API, behavior or storage changes.

### Changed

- **ui:** the admin SPA, the viewer widget and the React embeds (`<LinksDashboard>`,
  `<LinkAnalytics>`) render the bare xtandard-links symbol per theme: `symbol.svg` on dark surfaces
  and the new `symbol-light.svg` (the light lockups' deeper lime) on light ones, inlined as data
  URLs. No square tile, and no assets to serve.
- **brand:** SVG-only logos wherever users see them (README, docs site, UI); the PNG logo variants
  are gone (`docs/assets/logo*.png`, `symbol.png`, `lockup-*.png`). Rasters remain only for the
  favicon set, the Apple touch icon and `social.png`. The docs home hero now uses the stacked
  lockups (light/dark), matching the other xtandard projects.

### Fixed

- **brand:** horizontal lockups are vertically centred with the shared xtandard rule (symbol centre
  = baseline - capHeight/2), so the symbol sits on the wordmark's optical centre in the navbar and
  the README header.
- **hooks:** the pre-commit hook no longer fails on commits that only touch formatter-ignored files
  (site `.mdx` pages, `CHANGELOG.md`).

### Documentation

- Docs site: Project status and Changelog pages; strict internal-link validation on every page.
- Ecosystem section (README, docs home and ecosystem page): adds `@xtandard/audit`,
  `@xtandard/entitlements` (with its npm link) and `@xtandard/xyte`.

### Migration

None. Drop-in from v0.1.0: no API, configuration, storage layout or analytics changes. If you
linked to the removed PNG logos in `docs/assets/` on GitHub, switch to the `.svg` files of the same
name.

## v0.1.0

First release — self-hosted, embeddable branded short links as a library.

### Added

- **Core** (`createLinksCore`): tenants, domains (shared or tenant-owned, default domain, case
  sensitivity, `rootUrl`/`notFoundUrl`), links (generated or custom slugs incl. nested, tags,
  external ids, expiry + `expiredUrl`, `maxClicks`, PBKDF2 passwords, UTM templates, link-preview
  overrides, iOS/Android destinations, redirect status, query pass-through, archive/disable),
  bulk import with dry run and conflict policies, an operator audit log, `before`/`after` hooks.
- **Redirect plane** (`createRedirectHandler`): memory-first resolver (LRU + TTL +
  stale-while-revalidate + negative cache + last-known-good + watch invalidation), targeting
  rules with deterministic weighted A/B variants, password gate, Open Graph pages for unfurlers,
  `.well-known` association files, Play install referrer, deferred deep-link claim endpoint,
  fall-through composition, `waitUntil` support for edge runtimes. Never throws into the host.
- **Click ingestion**: async batched ingestor with retries and overflow reporting; bot and
  link-preview detection, user-agent parsing, geo from Cloudflare/Vercel/CloudFront/Fastly headers
  or a custom resolver, privacy modes (IPs dropped by default, daily-salted visitor hash, DNT/GPC).
- **Analytics sinks** behind one port and one conformance suite: KV rollups in the links storage
  (default), memory, ClickHouse, Tinybird and Workers Analytics Engine.
- **Conversions**: click ids on destinations, `@xtandard/links/client` capture helper,
  `trackLead` / `trackSale` (idempotent by invoice) with the click's dimensions.
- **Storage drivers**: memory, file, Redis (+ RedisJSON), Postgres, Drizzle (pg/mysql/sqlite table
  helpers), MongoDB, SQLite, libSQL, unstorage, Cloudflare KV — all passing the storage
  conformance suite (case-exact keys, literal prefixes).
- **Admin panel** (`createFetchHandler`): JSON API with OpenAPI 3.1, QR codes (SVG), CSV
  import/export (native, Bitly, Dub, Shlink, Kutt), auth (`none`, `basic`, `delegated`),
  authorization (`none`, `roles`, `delegated`), analytics **viewer tokens** for a per-tenant widget.
- **UI**: bundled admin SPA (links, link detail, analytics, domains, import, conversions, audit,
  rules editor), the viewer widget chrome, and React embeds `<LinksDashboard>` / `<LinkAnalytics>`.
- **Adapters**: Elysia (1 and 2, Eden-typed plugin), Hono, Express, Bun, Next.js — each with
  `linksPanel` and `linksRedirect`.
- **Bridges**: publish link/conversion (and optionally click) events to `@xtandard/webhooks`;
  record changes in `@xtandard/audit`.
- CLI (`xtandard-links serve | links | domains | import | export | stats | qr | prune`),
  standalone Docker image, examples, docs site, brand kit.
