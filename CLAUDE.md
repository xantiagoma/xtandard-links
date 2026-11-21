# @xtandard/links

Self-hosted, embeddable branded short links: memory-first redirects, click analytics, conversion
attribution and deep links, with pluggable storage and an embeddable admin UI. Bun for tooling;
`bun run check && bun run test` is the gate (`bun run format` before committing).

- Plan: `PLAN.md`; progress: `WORKLOG.md`; decisions: `docs/ADR/`; brief: `MISSION.md` (do not edit).
- Structure mirrors `@xtandard/webhooks` / `@xtandard/flags`. Every new subpath export needs four
  edits: `src/entry-*.ts`, `vite.config.ts` `pack.entry`, `package.json` `exports`, and
  `examples/tsconfig.json` `paths`.
- Two planes (ADR 0002/0004): the admin panel (`createFetchHandler`) and the redirect handler
  (`createRedirectHandler`). The redirect path must never throw into the host or wait on the
  analytics sink; keep it free of optional dependencies (it runs on edge runtimes).
- Analytics go through the `AnalyticsSink` port (`src/analytics/`), never straight to storage.
- Storage drivers must pass `test/storage-contract.ts`; analytics sinks must pass
  `test/analytics-contract.ts`.

## Docs Site

`site/` is an Astro Starlight site (own `package.json`/lockfile, not published) deployed by
`.github/workflows/pages.yml` to https://me.xantiagoma.com/xtandard-links/.

- `README.md` and `docs/*.md` stay the source of truth (they render on GitHub/npm).
  `site/scripts/sync.ts` copies them into `site/src/content/docs/` (generated, gitignored); README
  sections become pages per `site/manifest.ts` — so **renaming an H2 in `README.md` that the
  manifest lists, or adding/renaming a file in `docs/`, needs `site/manifest.ts` updated** (sync
  fails loudly otherwise). Relative links between docs are rewritten to site routes.
- Site-only pages (the home page) live in `site/content/`.
- The API reference is generated from `src/` by starlight-typedoc, one module per `exports` entry
  in `package.json` (`entries()` in `site/manifest.ts`). Each entry file starts with a
  `@module <name>` doc comment that names and describes its page.
- `bun run docs:dev` / `docs:build` / `docs:preview`. Astro runs under Bun (`bun --bun astro …`);
  `.mdx` is excluded from `vp fmt` (it mangles MDX). The build fails on any broken internal link.
