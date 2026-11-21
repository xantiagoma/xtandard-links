# Mission: `@xtandard/links`

You are the **lead** for a new project in the user's xtandard ecosystem: **branded short links, click
analytics, conversion attribution and deep links as an embeddable library** (the Dub / Bitly niche, in
the xtandard shape). You own it end to end: research check, design, implementation, tests, docs, docs
site, CI/CD and release prep. **Do not stop until the Definition of Done is met.**

Your coordinator is the hc terminal **`t1r`** (report with `hc send t1r "…"`; its messages arrive tagged
`<hc from="t1r …">`). Keep this file unedited; your plan goes in `PLAN.md`, progress in `WORKLOG.md`.

**Read first, fully:** `/Users/santi/Projects/xtandard-missions/ecosystem-lead-rules.md` (how to work:
references, team, rules, reporting, Definition of Done; `<name>` = `links`, package `@xtandard/links`,
repo `xantiagoma/xtandard-links`, docs at `https://me.xantiagoma.com/xtandard-links/`).

**What to build:** the research report `/Users/santi/Projects/xtandard-missions/research/links.md`
(section 8 "Verdict" has the gap and the product sketch: core link model + rules, memory-first redirect
plane with framework + edge adapters, async batched click ingestion with bot filtering / geo / UA /
privacy modes, conversion attribution (trackLead / trackSale), storage ports + contract tests, separate
analytics sink port with rollups and ClickHouse/Tinybird/Analytics Engine adapters, deep links (AASA /
assetlinks, store fallback, deferred deep links), QR codes, bulk import, embeddable React admin + a
per-tenant analytics widget with scoped tokens, ecosystem bridges to @xtandard/webhooks and
@xtandard/audit). Treat that sketch as the starting scope; refine it in PLAN.md + ADRs.

**Research check first:** re-verify the landscape quickly (anything new in the last weeks, licenses of
Shlink/Kutt/Sink/Dub, `@verevoir/link-tracking`), commit it as `docs/research/landscape.md` (start from
the research report), and send t1r a short verdict. If a permissive, maintained, embeddable equivalent
now exists, stop and report; otherwise continue without waiting.
