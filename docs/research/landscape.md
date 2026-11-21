# Landscape: short links + click analytics (research gate)

Date of research: 2026-11-20. "Recent" means activity on or after 2026-05-20 (about 6 months).

Method: `gh search repos` on the topics `url-shortener`, `link-shortener`, `short-links`, `shortlink`,
`urlshortener`, `link-management` and `link-analytics` (top 25 by stars each). Then `gh api repos/OWNER/REPO`
for stars, last push, creation date and archived flag; `.../releases`, `.../commits` and
`.../contributors` for activity; `.../license` with the LICENSE text decoded and read. npm registry
search (`/-/v1/search`) for "url shortener", "link shortener", "short link", "shortlink",
"short url analytics", "link analytics", "click tracking redirect", "deep link" and "vanity url";
`npm view` and the npm downloads API for the libraries that looked embeddable. Web search for 2026
launches and for Firebase Dynamic Links replacements. Dub's PR #4783 file list was read via the API.

Star, download and issue counts are as of 2026-11-20. "unknown" means I could not verify it.

What we are comparing against: an **embeddable, self-hosted, MIT TypeScript library**. You create
links (slug, destination, custom domain, expiry, password, device/geo targeting, UTM), mount a redirect
handler in your own app (Elysia / Hono / Express / Bun / Next), record clicks into pluggable storage, query
analytics, and get an embeddable React admin UI plus a per-tenant analytics widget.

---

## 1. The reference product: Dub

- Repo: **https://github.com/dubinc/dub now redirects to `dubinc/dub.link`** (renamed). 25,206★,
  75 open issues. No GitHub releases.
- **LICENSE file (read):** "Portions of this software, namely all files under `apps/web/app/(ee)` and
  `apps/web/app/app.dub.co/(dashboard)/[slug]/(ee)`, are licensed under `ee/LICENSE.md`" (commercial).
  Everything else is **AGPLv3**. GitHub reports `NOASSERTION`. So this is open-core plus copyleft, and it fails
  the license bar twice.
- **The public repo is shrinking.** PR #4783, "Simplify Dub", merged 2026-10-26, is **+1,686 / −373,626
  lines**. The 100 files the API lists are mostly deletions under `apps/web/app/(ee)` (partner and
  conversion features). The last commit was 2026-10-26 ("Update README.md") and the last push 2026-10-27,
  while Dub's SDK repos (`dub-ts`, `dub-go`, …) were all pushed on 2026-11-20. My inference, not
  confirmed: product development moved to a private repo, and the public tree is now a reduced "Dub Links".
  I found no announcement.
- Shape: a Next.js SaaS app. Its stated stack is Prisma + PlanetScale, Upstash Redis, **Tinybird for
  analytics** (hosted ClickHouse), NextAuth, BoxyHQ, Stripe, Resend and Vercel. You can self-host the
  whole app, but you cannot embed it as a library.
- MIT/MPL client pieces: `dub` (TS SDK for the hosted API, MIT, 1.15M dl/mo), `@dub/embed-react`
  (MIT, 173k dl/mo; it embeds Dub-hosted referral dashboards), `@dub/analytics` (**MPL-2.0**, 841k dl/mo,
  a conversion-tracking script). All of them talk to Dub's cloud.
- Why not sufficient: AGPL plus a proprietary `(ee)`, a SaaS app that depends on hosted services, and an
  open repo that is going quiet.

## 2. Self-hosted shortener apps (permissive)

| Project                                                         | License (file read) | Activity                                                                               | Shape                                                                                                              | What it lacks for us                                                                            |
| --------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| **shlinkio/shlink**                                             | MIT                 | 5,434★, v5.1.8 on 2026-10-21, pushed 2026-11-13, 27 contributors                       | **PHP service** (REST API, CLI, Docker). Visits with geolocation, bot detection, tags, domains, QR, redirect rules | Not TS and not embeddable. You run a PHP server beside your app. Best-in-class _service_ though |
| shlinkio/shlink-web-client + **@shlinkio/shlink-web-component** | MIT                 | web-client v4.9.0 on 2026-10-31; component 0.20.0 published 2026-10-15, 2.2k dl/mo, 6★ | React app; **an embeddable React component** "to interact with Shlink on React applications"                       | Only a UI for a Shlink _server_; it is not a library that owns storage                          |
| thedevs-network/kutt                                            | MIT                 | 11,215★, v3.2.6 on 2026-07-05, pushed 2026-10-19, 56 contributors                      | Express + Handlebars app (knex over SQLite/PG/MySQL, optional Redis/Bull)                                          | A standalone server-rendered app; no library API, no React UI                                   |
| YOURLS/YOURLS                                                   | MIT                 | 12,310★, 1.10.6 on 2026-08-30, pushed 2026-11-19                                       | PHP app with a plugin ecosystem                                                                                    | PHP, standalone                                                                                 |
| SinTan1729/chhoto-url                                           | MIT                 | 1,019★, 7.11.7 on 2026-11-19                                                           | Rust single binary, deliberately minimal                                                                           | No analytics depth; not embeddable                                                              |
| oddbit/shrtnr                                                   | Apache-2.0          | 33★, created 2026-03-27, pushed 2026-11-20; `@oddbit/shrtnr` SDK 304 dl/mo             | Cloudflare Workers + D1 app with REST, MCP and SDKs                                                                | Workers-only app; the SDK is a client                                                           |
| realodix/urlhub                                                 | MIT                 | 543★, pushed 2026-11-20                                                                | Laravel app                                                                                                        | PHP app                                                                                         |
| surishortlink/suri                                              | MIT                 | 395★, pushed 2026-10-21                                                                | Static-site generator for redirects                                                                                | No analytics                                                                                    |
| changkun/redir, jwma/jump-jump, adhocore/go-urlsh               | MIT                 | active 2026                                                                            | Go services                                                                                                        | Go services                                                                                     |
| buildlabs-io/url-link                                           | MIT                 | 130★, created 2025-08-28, pushed 2026-11-05                                            | FastAPI + Next.js app                                                                                              | App, Python backend                                                                             |
| xyTom/Url-Shorten-Worker, ngshiheng/atomic-url, vanityURLs/code | MIT                 | active                                                                                 | Cloudflare Worker scripts                                                                                          | Toy-sized; no analytics model                                                                   |
| origranot/reduced.to                                            | MIT                 | 703★, **archived** (last push 2025-04-25)                                              | NestJS + Qwik app                                                                                                  | Dead                                                                                            |

## 3. Copyleft or non-permissive shorteners (excluded on license)

| Project                                                                         | License (file read)                               | Activity                                                         | Notes                                                                                                  |
| ------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| miantiao-me/**Sink**                                                            | **AGPL-3.0** (since the first commit, 2024-05-25) | 7,289★, v0.3.1 on 2026-09-27, pushed 2026-10-27, 37 contributors | Nuxt on Cloudflare Workers + Analytics Engine. The strongest "serverless with analytics" app, but AGPL |
| yourselfhosted/slash                                                            | AGPL-3.0                                          | 3,192★, last release v0.5.3 on **2024-02-06**                    | go-links for teams; stale releases                                                                     |
| Snazzah/stub                                                                    | AGPL-3.0                                          | 217★, pushed 2026-11-20                                          | Dub fork for single-user self-hosting                                                                  |
| idhamsy/openshortlink                                                           | AGPL-3.0                                          | 123★, created 2025-12-15                                         | Cloudflare-only app                                                                                    |
| luadotsh/lua, spoo-me/spoo, flyfish-dev/shortlink, FlaredLink/Flared, link-rift | AGPL-3.0                                          | 2024–2026                                                        | Apps                                                                                                   |
| JaneJeon/blink                                                                  | AGPL-3.0                                          | **archived**                                                     | Dead                                                                                                   |
| cydrobolt/polr                                                                  | GPL-2.0                                           | last push 2024-05-28                                             | Dead                                                                                                   |

## 4. TypeScript libraries (the shape we want)

| Package                                                                            | License                                                                 | Activity / adoption                                                           | Shape                                                                                                                                     | What it lacks                                                                                          |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **@verevoir/link-tracking**                                                        | npm says MIT; **the GitHub repo has no LICENSE file** (API returns 404) | 2.0.0 on 2026-08-05; repo 0★, 1 contributor; **21 dl/mo**                     | The closest _shape_: `createTracker({ store })` with shorten / resolve / recordClick / getStats over a pluggable store, zero dependencies | No HTTP adapters, UI, domains, targeting, bot filtering, rollups or multi-tenancy. A single-author toy |
| @hasna/shortlinks                                                                  | Apache-2.0                                                              | 0.5.0 on 2026-09-20, 193 dl/mo; the repository URL (`hasna/apps`) returns 404 | CLI + MCP + redirect server + SDK over local SQLite or a hosted `/v1`                                                                     | A tool, not an embeddable library; no visible source                                                   |
| @the_shujaa/link-shortener, @shyamraghuonec/link-shortener                         | Apache-2.0                                                              | 0.1.1, both last published 2026-02; 3★                                        | **Convex components** (links, click analytics, UTM)                                                                                       | Convex-only; dormant                                                                                   |
| @mixxtor/adonisjs-shortlink                                                        | MIT                                                                     | 1.1.2 on 2025-12-16                                                           | AdonisJS service                                                                                                                          | One framework; no analytics UI                                                                         |
| kutt, @shlinkio/shlink-js-sdk, dub, zulink, @opa.sh/sdk, U2L, @posty5/short-link … | MIT and others                                                          | various                                                                       | **API clients** for a server or SaaS                                                                                                      | Clients, not engines                                                                                   |
| shortid, nanoid, short-unique-id                                                   | MIT / Apache                                                            | huge                                                                          | ID generators                                                                                                                             | Primitives only                                                                                        |

I found **no TypeScript library** that combines link CRUD, a mountable redirect handler, click ingestion,
analytics rollups, pluggable storage and an embeddable React UI.

## 5. Hosted SaaS (context only)

Bitly, Short.io, Rebrandly, Linkly, Zulink, Bitly-like MCP servers (sendurl, revroute, rus.sh) and Dub Cloud.
They are proprietary hosted services with MIT SDKs at most.

## 6. Adjacent: deep links after Firebase Dynamic Links

- **Google shut down Firebase Dynamic Links on 2025-08-25** (Firebase migration guide:
  https://firebase.google.com/support/guides/app-links-universal-links). The replacements are hosted:
  Branch, AppsFlyer, Flinku (open SDKs, hosted backend), urlgeni.us, and Dub (deep linking in its
  AGPL/SaaS product, https://dub.co/blog/firebase-alternative).
- OSS: `jauntybrain/flow-links-extension` (a Firebase extension) and `yinebebt/deeplink` (MIT, Go, 13★,
  created 2026-04-04: short links, deep links, OG previews, click analytics, MCP; Redis/SQLite). I found
  **no TS library** that serves `apple-app-site-association` / `assetlinks.json`, does device-aware
  fallback routing and supports deferred deep links.
- So deep linking is a natural differentiator to put _inside_ the links product, not a separate project.

---

## 7. Summary table

| Name                                   | License (verified)                | Last activity                               | Shape                                             | Embeddable TS lib? | Why not sufficient                               |
| -------------------------------------- | --------------------------------- | ------------------------------------------- | ------------------------------------------------- | ------------------ | ------------------------------------------------ |
| Dub (`dubinc/dub.link`)                | **AGPL-3.0 + proprietary `(ee)`** | commit 2026-10-26; −373k-line "Simplify" PR | Next.js SaaS app (Tinybird, Upstash, PlanetScale) | ✗                  | License; SaaS-shaped; public repo receding       |
| Shlink (+ web component)               | MIT                               | 2026-11-13 / 2026-10-31                     | PHP service + React UI for it                     | ✗ (UI only)        | Separate PHP server; not TS                      |
| Kutt                                   | MIT                               | 2026-10-19                                  | Express/Handlebars app                            | ✗                  | Standalone app                                   |
| YOURLS                                 | MIT                               | 2026-11-19                                  | PHP app                                           | ✗                  | PHP app                                          |
| chhoto-url                             | MIT                               | 2026-11-19                                  | Rust binary                                       | ✗                  | Minimal; app                                     |
| shrtnr                                 | Apache-2.0                        | 2026-11-20                                  | Cloudflare Workers app                            | ✗                  | Workers-only app                                 |
| Sink                                   | **AGPL-3.0**                      | 2026-10-27                                  | Nuxt / Workers app                                | ✗                  | License                                          |
| Slash, Stub, OpenShort.link, lua, spoo | **AGPL-3.0**                      | 2024–2026                                   | Apps                                              | ✗                  | License                                          |
| @verevoir/link-tracking                | npm MIT, **no repo LICENSE**      | 2026-08-05                                  | TS library                                        | ✓ (core only)      | 0★, 21 dl/mo, no adapters, UI or analytics depth |
| @hasna/shortlinks                      | Apache-2.0                        | 2026-09-20                                  | CLI / server / SDK                                | partial            | Source not visible; tool shape                   |
| Convex link-shortener components       | Apache-2.0                        | 2026-02                                     | Convex component                                  | Convex only        | Platform-bound; dormant                          |
| Firebase Dynamic Links                 | proprietary                       | **shut down 2025-08-25**                    | —                                                 | —                  | Gone; leaves a deep-link vacuum                  |

## 8. Verdict: **BUILD** (`@xtandard/links`)

**The gap.** Every permissive, actively maintained shortener is a _standalone app or service_: Shlink
(PHP), Kutt (Express app), YOURLS (PHP), chhoto (Rust) and shrtnr (Workers). The TypeScript-native ones
with real analytics are AGPL (Sink, Dub, Slash and the 2026 Cloudflare apps). Dub is the de facto
reference, and it is AGPL plus a proprietary `(ee)`, depends on hosted Tinybird/Upstash/PlanetScale, and
just deleted ~373k lines from its public repo. The only TS library with the right shape
(`@verevoir/link-tracking`) has no LICENSE file, no adoption and only the shorten/resolve/count core.
Nothing lets a TS SaaS add branded short links and click analytics _inside its own app and database_ with
an embeddable admin UI and a per-tenant analytics widget. Shlink comes closest in features, and its MIT
React component shows the UI half is wanted, but it requires a second PHP server.

Recommend instead, if the user only needs a shortener for themselves: **Shlink** (MIT, the most complete
and actively released), with `@shlinkio/shlink-web-component` for an in-app UI.

**Sketch of the xtandard-shaped product:**

- **Core:** `createLinks({ storage, analytics, domains })`. Link model: slug (nanoid or custom),
  destination, domain, tenant, tags, expiry plus an expired URL, password, max clicks, UTM template, OG
  overrides (link previews), and rules (device / OS / geo / language / A-B weights) evaluated in order.
- **Redirect plane, memory-first like @xtandard/flags:** a hot slug → rule cache with a
  last-known-good snapshot, so a redirect never waits on the admin store. Mountable handlers for
  Elysia / Hono / Express / Bun.serve / Next middleware, plus an edge variant (Workers KV / Vercel Edge
  Config adapters for the resolve path).
- **Click ingestion:** async, batched, with bot and preview-crawler filtering (`isbot`-style), optional
  IP → geo (pluggable: MaxMind file, Cloudflare headers), UA parsing, referrer, a click-id cookie or query
  param for **conversion attribution** (`trackLead` / `trackSale`, the open version of `@dub/analytics`),
  and privacy modes (hash or drop IPs).
- **Storage:** Drizzle adapters (Postgres / SQLite / MySQL) plus memory for tests, with a contract test
  suite as in flags and webhooks. **Analytics sink is a separate port:** the same DB with time-bucket
  rollups by default, and ClickHouse / Tinybird / Analytics Engine adapters for scale.
- **Deep links:** serve `/.well-known/apple-app-site-association` and `assetlinks.json` per domain, app
  store fallback, and a deferred deep-link handoff (click id → first app open). This fills the
  Firebase Dynamic Links vacuum.
- **UI:** an embeddable React admin (links, domains, QR codes, bulk CSV import, analytics charts) and a
  per-tenant **analytics widget** with scoped viewer tokens, the same pattern as the audit viewer.
- **Ecosystem:** click / threshold events out via **@xtandard/webhooks**, link edits into
  **@xtandard/audit**, and plan limits (links per month, custom domains) via the entitlements project
  below.

Risk: short links are a commodity, so the value is entirely in the _embeddable_ shape (links as a feature
of someone else's SaaS: email tools, CRMs, social schedulers, creator platforms), not in competing with
Bitly as an app. Keep the MVP to core, redirect, analytics rollups and the admin UI. Deep links and
conversions come second.

Sources: https://github.com/dubinc/dub.link (LICENSE.md, PR #4783), https://github.com/shlinkio/shlink,
https://github.com/thedevs-network/kutt, https://github.com/miantiao-me/Sink,
https://www.npmjs.com/package/@verevoir/link-tracking, https://github.com/oddbit/shrtnr,
https://firebase.google.com/support/guides/app-links-universal-links, https://dub.co/blog/firebase-alternative,
https://ossalt.com/guides/dub-vs-shlink-2026, https://alternativeto.net/software/dub

---

## 9. Re-verification at the research gate (2026-11-20, lead)

Re-checked the same day the project started, before committing to build:

- **Dub** (`dubinc/dub.link`): still `NOASSERTION` (AGPLv3 + proprietary `(ee)`), last commit still
  2026-10-26 "Update README.md" after "Simplify Dub (#4783)"; last push 2026-10-27. No change.
- **Sink**: AGPL-3.0, v0.3.1 (2026-09-27), last push 2026-10-27. No change.
- **Shlink**: MIT, v5.1.8 (2026-10-21), pushed 2026-11-13. Still a PHP service.
- **Kutt**: MIT, v3.2.6 (2026-07-05), pushed 2026-10-19. Still an Express app.
- **YOURLS** (MIT, pushed 2026-11-19), **chhoto-url** (MIT, pushed 2026-11-19), **shrtnr**
  (Apache-2.0, pushed 2026-11-20): unchanged shape (apps / a Workers app).
- **@verevoir/link-tracking**: still 2.0.0 (2026-08-05), npm says MIT, the GitHub repo still has **no
  LICENSE file** (license API 404), **21 downloads in the last month**.
- New npm entrants since 2026-10-01 for "url shortener" / "link shortener" / "link analytics":
  `@dytsou/shorten-url` (MIT, a Cloudflare Workers _app_, 1.1k dl/mo), `@theshantanujoshi/hash`
  (MIT, a CLI + redirect server, created 2026-10-21, 498 dl/mo), `zulink` / `@zulink/mcp` (clients for a
  SaaS), `@corsair-dev/cuttly` (a Cutt.ly client), `link-shortener-mcp` (is.gd client). None is an
  embeddable engine with storage ports, analytics and UI.
- New GitHub TS repos created since 2026-10-01 (`gh search repos "url shortener" --language=typescript`):
  the largest is `jntegz/shorthop` (MIT, 5★, "URL shortener with revenue attribution, in one Cloudflare
  Worker you own"), an app, not a library. The rest are coursework-sized apps.

**Verdict unchanged: BUILD.** No permissive, maintained, embeddable TypeScript equivalent exists.
