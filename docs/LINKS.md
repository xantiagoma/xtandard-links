# Links & domains

The data model of the control plane: tenants own links, links live on domains, and everything a link
can do is a field on it. `src/schema.ts` is the authoritative reference; this page explains how the
fields behave.

## Tenants

A **tenant** is the unit of ownership, typically one of _your_ customers or workspaces. Every link
belongs to exactly one tenant; analytics queries and viewer tokens are scoped to one tenant.

- Single-tenant hosts never mention it: the tenant defaults to `"default"` (`DEFAULT_TENANT`).
- Tenants are created implicitly by their first link (or their first owned domain).
  `core.upsertTenant({ key, name?, metadata? })` adds a name and host-defined metadata (plan,
  limits).
- Keys allow `a-z A-Z 0-9 . _ -`.
- `core.deleteTenant(key)` deletes the tenant, every link it owns and every domain it owns.
  Analytics events stay in the sink.

## Domains

A **domain** is a hostname that serves short links (`go.acme.com`). DNS and TLS are your edge's
job; the library only needs to know the hostname.

```ts
await core.createDomain({
  hostname: "go.acme.com", // lowercase, no scheme or port
  isDefault: true, // used when a link names no domain
  rootUrl: "https://acme.com", // where "/" redirects (unset: fall through)
  notFoundUrl: "https://acme.com/404", // where unknown slugs redirect (unset: 404 page)
});

// A customer's branded domain: only that tenant may use it.
await core.createDomain({ hostname: "links.customer.com", tenant: "customer-42", isDefault: true });
```

| Field           | Default        | Notes                                                                                    |
| --------------- | -------------- | ---------------------------------------------------------------------------------------- |
| `hostname`      | required       | stored lowercase                                                                         |
| `tenant`        | unset (shared) | a shared domain is usable by every tenant; an owned one only by its tenant               |
| `isDefault`     | `false`        | one default per owner: setting it clears the flag on the owner's other domains           |
| `rootUrl`       | —              | redirect target for the bare domain                                                      |
| `notFoundUrl`   | —              | redirect target for unknown or disabled slugs                                            |
| `caseSensitive` | `false`        | match slugs case-sensitively; cannot change while the domain has links (`ConflictError`) |
| `slugLength`    | `7`            | length of generated slugs, 3–32                                                          |
| `apps`          | —              | iOS / Android associations served from `/.well-known/` ([Deep links](DEEP_LINKS.md))     |
| `metadata`      | —              | host-defined JSON                                                                        |

**Which domain a new link gets** when `domain` is omitted: the tenant's own default domain, else the
shared default, else the only domain the tenant may use; otherwise creation fails with a validation
error. `defaultDomain` on the core (`"localhost"`, `"go.acme.com"`) registers a shared default
domain automatically on first use, so small installs never call `createDomain`.

`core.deleteDomain(hostname)` refuses while links use the domain; `{ force: true }` deletes them.
`core.listDomains({ tenant })` returns the shared domains plus that tenant's own.

## The link

```ts
const link = await core.createLink({
  tenant: "customer-42", // default "default"
  domain: "links.customer.com", // default: see above
  slug: "sale", // default: generated
  url: "https://customer.com/sale", // the only required field
  title: "Black Friday",
  tags: ["campaign", "q4"],
  externalId: "campaign-881", // your id; unique per tenant
});
```

Everything but `url` is optional. `core.updateLink(tenant, id, patch)` takes any subset; `null`
clears a field. Changing `domain` or `slug` moves the slug pointer atomically (the new slug is
claimed before the old one is released).

| Field                          | Default | Behaviour                                                                              |
| ------------------------------ | ------- | -------------------------------------------------------------------------------------- |
| `url`                          | —       | absolute `http(s)` URL, or an app scheme (`myapp://…`) unless `allowAppSchemes: false` |
| `slug`                         | random  | see [Slugs](#slugs)                                                                    |
| `title`, `description`         | —       | shown in the UI; `title` is the fallback preview title                                 |
| `tags`                         | `[]`    | trimmed and de-duplicated; `core.listTags(tenant)` counts them                         |
| `externalId`                   | —       | unique per tenant; `core.getLinkByExternalId`; makes imports idempotent                |
| `expiresAt`, `expiredUrl`      | —       | [Expiry](#expiry-and-click-budgets)                                                    |
| `maxClicks`                    | —       | [Expiry](#expiry-and-click-budgets)                                                    |
| `password`                     | —       | [Passwords](#passwords); write-only                                                    |
| `utm`                          | —       | [UTM parameters](#utm-parameters-and-query-pass-through)                               |
| `preview`                      | —       | [Link previews](#link-previews)                                                        |
| `rules`                        | `[]`    | targeting and A/B tests: [Rules](RULES.md)                                             |
| `ios`, `android`               | —       | destinations for iOS / Android visitors (store listings): [Deep links](DEEP_LINKS.md)  |
| `deepLink`                     | —       | `{ path, deferred }`: [Deep links](DEEP_LINKS.md)                                      |
| `redirectStatus`               | `302`   | `301`, `302`, `307` or `308`                                                           |
| `trackConversions`             | `false` | append the click id for attribution: [Conversions](CONVERSIONS.md)                     |
| `passQuery`                    | `true`  | forward the short URL's query string                                                   |
| `indexable`                    | `false` | omit `X-Robots-Tag: noindex` so search engines may index the short URL                 |
| `disabled`                     | `false` | the link answers like an unknown slug (404 page or `notFoundUrl`)                      |
| `archived`                     | `false` | hidden from lists by default; **still redirects**                                      |
| `metadata`                     | —       | host-defined JSON                                                                      |
| `id`, `createdAt`, `updatedAt` | server  | `id` is `lnk_` + a time-sortable id; `createdBy` is the actor id when one was passed   |
| `clicks`                       | server  | approximate non-bot count, filled in by `listLinks` and the API                        |

Mutations accept `{ actor: { id, email?, name? } }` as a second argument; it is recorded in the
audit log (`core.listAudit(tenant)`) and passed to hooks.

### Listing

`core.listLinks(tenant, { search, tag, domain, archived, limit, cursor })` returns
`{ links, total, nextCursor? }`, newest first. `search` matches slug, URL, title, tags and domain
case-insensitively; `archived` is `false` (default), `true` or `"all"`; `limit` defaults to 50
(max 500). Listing scans the tenant's links in storage: fine at library scale, and the reason tags
have no secondary index (ADR [0005](ADR/0005-storage-kv-contract.md)).

## Slugs

ADR [0012](ADR/0012-slugs.md):

- **Case-insensitive by default.** The lookup key is the slug NFC-normalized and lowercased, so
  `/Sale` and `/sale` are the same link; the slug as written is kept for display. A domain with
  `caseSensitive: true` keeps case.
- **Allowed characters:** Unicode letters and digits, `-`, `_`, `.`, `~`, and `/` between segments
  (nested slugs like `docs/intro`). 1–190 characters; no segment made only of dots.
- **Generated slugs:** 7 characters (the domain's `slugLength`) from
  `23456789abcdefghjkmnpqrstuvwxyz` (no look-alikes `0 o 1 l i`), or that plus uppercase on
  case-sensitive domains, drawn with Web Crypto. Collisions are retried; every fifth retry adds a
  character.
- **Reserved first segments:** `.well-known`, `api`, `_links`, `favicon.ico`, `robots.txt` (the
  core's `reservedSlugs` option). Creating such a slug is a validation error, and the redirect
  handler never treats those paths as slugs.
- **Uniqueness** is per domain across all tenants: a `compareAndSwap` claim on the slug pointer when
  the storage supports it, otherwise read-then-write with a re-read check ([Storage](STORAGE.md)).
  A taken slug is a `ConflictError` (HTTP 409).

## Expiry and click budgets

- `expiresAt` (ISO-8601): from that instant the link is expired. Checked on every request against
  the cached record, so it is exact.
- `maxClicks`: the link expires after that many non-bot clicks. The counter is approximate: clicks
  are counted in memory and flushed to storage every 2 seconds (`counterFlushMs`), with
  compare-and-swap when the storage supports it. Several redirect processes may each let a few extra
  clicks through around the limit.
- Expired links redirect to `expiredUrl` when set, otherwise answer a **410** "Link expired" page.

## Passwords

`password: "hunter2"` stores a PBKDF2-SHA256 hash (Web Crypto) and never returns it: API responses
carry `hasPassword: true` instead. Visitors see a password form; a correct `POST` sets an
`HttpOnly`, `SameSite=Lax` cookie valid for one hour on that link and redirects back with `303`.
A wrong password re-renders the form with a 401. Changing the password invalidates every unlock
cookie (the cookie value is derived from the stored hash). `password: null` removes protection.

## Link previews

When Slack, X, iMessage, WhatsApp, LinkedIn, Discord, Telegram and other unfurlers (`isPreviewBot`)
fetch a link that has `preview` set, the handler answers an HTML page with Open Graph and Twitter
card tags instead of the redirect:

```ts
await core.updateLink("default", link.id, {
  preview: {
    title: "Spring sale: 30% off",
    description: "Until Sunday only.",
    image: "https://acme.com/og/spring.png",
  },
});
```

Without `preview`, unfurlers follow the redirect and read the destination's own tags. Preview
fetches are recorded as bot clicks, never as `clicks`.

## UTM parameters and query pass-through

The destination is built from the target URL in this order:

1. `utm: { source, medium, campaign, term, content }` adds `utm_*` parameters, **never overriding**
   ones already on the destination.
2. With `passQuery` (default on), the short URL's own query string is forwarded, except the
   internal `qr` and `pw` parameters and the click-id parameter; again, parameters already on the
   destination win. So `go.acme.com/sale?ref=tw` reaches `acme.com/sale?ref=tw`.
3. With conversions on, `xl_id={clickId}` is set ([Conversions](CONVERSIONS.md)).

App-scheme URLs get the same treatment when they parse as URLs; anything unparseable is left
untouched. On the click event, `utm` merges the short URL's `utm_*` parameters (which win) with
the link's.

## QR codes

`@xtandard/links/qr` renders crisp SVG QR codes with the zero-dependency `uqr` encoder, in any
runtime:

```ts
import { qrUrl, renderQrSvg, shortUrl } from "@xtandard/links/qr";

shortUrl(link); // "https://go.acme.com/sale"
const svg = renderQrSvg(qrUrl(link), {
  size: 512, // px, default 256
  margin: 2, // quiet zone in modules
  foreground: "#0f1215",
  background: "transparent", // default "#ffffff"
  ecc: "Q", // L | M (default) | Q | H
});
```

`qrUrl` encodes the short URL with `?qr=1`, so scans are recorded with `qr: true` (the `qr`
analytics dimension) and can be routed by the `qr` rule condition; the parameter is stripped from
the destination. `shortUrl` uses `http:` for `localhost` and IP hosts and takes the redirect
handler's `basePath`. The panel serves the same SVG at
`GET /api/tenants/:tenant/links/:id/qr.svg` ([HTTP API](HTTP_API.md)), and the CLI has
`xtandard-links qr` ([CLI](CLI.md)).

## Import and export

Migrate from another shortener, or round-trip your own links, as CSV. `@xtandard/links/import`
parses an export into `createLink` inputs; `core.importLinks` applies them:

```ts
import { parseLinksCsv, linksToCsv } from "@xtandard/links/import";

const rows = parseLinksCsv(await Bun.file("bitly-export.csv").text(), {
  format: "auto", // or native | bitly | dub | shlink | kutt
  tags: ["imported"], // added to every row
  // domain: "go.acme.com",   // put every row on one domain
  // keepDomains: true,       // keep the source domain (default only for `native`)
});
const result = await core.importLinks("default", rows, {
  dryRun: true, // validate and classify, write nothing
  onConflict: "skip", // or "update" | "error", when a row's externalId or slug exists
});
// { created, updated, skipped, errors, rows: [{ index, status, link?, error? }] }
```

| Format   | Destination column            | Slug from                                                   | Also read                                                                                      |
| -------- | ----------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `native` | `url`                         | `slug` (+ `domain`)                                         | every column `linksToCsv` writes                                                               |
| `bitly`  | `Destination URL`, `Long URL` | `Custom Bitlink`, else the path of `Bitlink` / `Short link` | `Title`, `Tags`, `Archived`                                                                    |
| `dub`    | `Destination URL`, `url`      | `key`, else the path of `Short link`                        | `domain`, `title`, `description`, `tags`, `externalId`, `expiresAt`, `utm_*`, `ios`, `android` |
| `shlink` | `Long URL`                    | `Short code`, else `shortUrl`                               | `domain`, `title`, `tags` (`\|`-separated), `validUntil`, `maxVisits`                          |
| `kutt`   | `target`                      | `address`, else `link` / `shortUrl`                         | `domain`, `description`, `expire_in`                                                           |

Headers are matched loosely (`Long URL`, `long_url` and `longUrl` are the same column) and unknown
columns are ignored. Foreign formats drop the source domain (`bit.ly` is not yours) unless
`keepDomains: true`. Row `i` of the result is data row `i` of the file, so errors point at file
rows. Every created or updated row runs the usual validation and hooks.

`linksToCsv(links)` exports the `native` format: every field, tags comma-joined, rules and metadata
as JSON, never passwords. It re-imports losslessly. The same flows are available as
`POST /api/tenants/:tenant/links/import` (JSON rows or a `text/csv` body) and
`GET /api/tenants/:tenant/links.csv` ([HTTP API](HTTP_API.md)), and as `xtandard-links import` /
`export` ([CLI](CLI.md)).

## Destination policy

Destination URLs (`url`, `expiredUrl`, `ios`, `android`, rule and variant URLs) must be absolute and
at most 8192 characters; `javascript:`, `data:`, `vbscript:`, `file:`, `blob:` and `about:` are
always rejected. Two core options tighten it:

```ts
createLinksCore({
  storage,
  allowAppSchemes: false, // http(s) only
  urlPolicy: (url) => (blocklist.has(url.hostname) ? "this domain is blocked" : null),
});
```

`urlPolicy` returning a message rejects the URL with a validation error: the hook for phishing and
malware block lists.

## Built-in pages

The redirect handler renders four small, unbranded, `noindex` pages itself: not found (404),
expired (410), password, and link preview. Render your own with `renderPage`:

```ts
createRedirectHandler({
  core,
  renderPage(page, request) {
    if (page.kind === "not-found") return new Response(myNotFoundHtml, { status: 404 });
    return null; // the built-in page for the others
  },
});
```

`page` is `{ kind: "not-found", host, slug }`, `{ kind: "expired", link }`,
`{ kind: "password", link, error? }` or `{ kind: "preview", link, destination }`.
