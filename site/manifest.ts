// The site's information architecture: which repository Markdown becomes which page, the sidebar
// tree, and the package's entry points. scripts/sync.ts reads it to write src/content/docs/, and
// astro.config.ts reads it to build the sidebar and the API reference, so a page and its sidebar
// entry cannot drift.
//
// The Markdown in the repository (README.md, docs/*.md) stays the single source of truth: it is
// what GitHub and npm render. A page is one of:
//   - a whole repository file (`src`);
//   - some H2 sections of one (`src` + `sections`, optionally `intro` for the text above the first
//     H2) — how README.md is split into several pages. Every H2 of a split file other than the
//     README must land on exactly one page, so a new section cannot silently disappear;
//   - a page written for the site only (`site`, relative to site/content/).
// Plain Node APIs only: Astro loads this file through Vite.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../", import.meta.url));
export const repoSlug = "xantiagoma/xtandard-links";
export const repoUrl = `https://github.com/${repoSlug}`;
export const packageName = "@xtandard/links";
export const npmUrl = "https://www.npmjs.com/package/@xtandard/links";
export const branch = "main";
/**
 * Where the site is served: the project site of xantiagoma.github.io, under the account's custom
 * domain. pages.yml passes what actions/configure-pages reports (SITE_ORIGIN, SITE_BASE), so a
 * domain change needs no code change.
 */
const rawOrigin = process.env.SITE_ORIGIN || "https://me.xantiagoma.com";
/** actions/configure-pages reports http://, which would leak into og:url, og:image and the sitemap. */
export const siteOrigin = rawOrigin.replace(/^http:\/\//, "https://");
export const siteBase = (process.env.SITE_BASE || "/xtandard-links").replace(/\/+$/, "");

// ---- entry points ---------------------------------------------------------------------------

export type Entry = {
  /** The API reference module name (the `@module` tag of the entry file) and its route. */
  module: string;
  /** The import specifier users write. */
  importPath: string;
  /** The source file, relative to the repository root. */
  source: string;
};

/** The root import's module name: `@xtandard/links` is documented at /api/links/. */
export const rootModule = "links";

/** Subpaths that are not TypeScript entry points (assets, the manifest). */
const nonCode = (key: string) =>
  key === "./package.json" || key.endsWith(".css") || key.includes("*");

/**
 * Subpaths whose source a sibling branch is still building. When the file exists it is
 * documented like any other entry point; while it is missing it is skipped with a warning
 * instead of failing the build. Every other missing source fails loudly. Empty this list once
 * the work has landed.
 */
const pendingEntries = new Set<string>();

/**
 * Every public entry point, in package.json `exports` order. The source file follows the build's
 * convention (vite.config.ts `pack.entry`): the root is src/index.ts, a few subpaths have their
 * own module (src/core.ts, src/redirect.ts, src/react.tsx…), and the rest are
 * src/entry-<path-with-dashes>.ts.
 */
export function entries(): Entry[] {
  const exportsMap = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
    .exports as Record<string, unknown>;
  const out: Entry[] = [];
  for (const key of Object.keys(exportsMap).filter((k) => !nonCode(k))) {
    const sub = key.replace(/^\.\/?/, "");
    const entryFile = `src/entry-${sub.replaceAll("/", "-")}.ts`;
    const candidates =
      sub === ""
        ? ["src/index.ts"]
        : sub.includes("/")
          ? [entryFile]
          : [`src/${sub}.ts`, `src/${sub}.tsx`, entryFile];
    const source = candidates.find((f) => existsSync(join(repoRoot, f)));
    if (!source) {
      if (pendingEntries.has(key)) {
        console.warn(`manifest.ts: skipping "${key}" (no source yet; listed in pendingEntries)`);
        continue;
      }
      throw new Error(`manifest.ts: no source entry for "${key}" in package.json`);
    }
    out.push({
      module: sub === "" ? rootModule : sub,
      importPath: sub === "" ? packageName : `${packageName}/${sub}`,
      source,
    });
  }
  return out;
}

// ---- pages ----------------------------------------------------------------------------------

export type Page = {
  /** Route without the base and without slashes; "" is the home page. */
  slug: string;
  /** Sidebar label; the page title when absent. */
  label?: string;
  /** Repository file the page is built from. */
  src?: string;
  /** Only these H2 sections of `src` (by heading text, in file order). */
  sections?: string[];
  /** With `sections`: also the H1 and the text above the first H2. */
  intro?: boolean;
  /** Page title when it does not come from the source's H1. */
  title?: string;
  /** Site-only page in site/content/ (.md or .mdx). */
  site?: string;
  /** Contributor-only material: a banner says so and search skips it. */
  internal?: boolean;
};
export type Link = { label: string; link: string };
export type Group = { label: string; collapsed?: boolean; items: Item[] };
export type Item = Page | Link | Group;

export const home: Page = { slug: "", site: "index.mdx" };

const adrs: [file: string, label: string][] = [
  ["0001-single-package-subpath-exports.md", "0001 · Subpath exports"],
  ["0002-redirect-plane-independence.md", "0002 · Redirect-plane independence"],
  ["0003-bundled-spa-ui.md", "0003 · Bundled SPA UI"],
  ["0004-panel-and-redirect-handlers.md", "0004 · Panel & redirect handlers"],
  ["0005-storage-kv-contract.md", "0005 · Storage contract"],
  ["0006-analytics-sink-port.md", "0006 · Analytics sink port"],
  ["0007-click-ingestion.md", "0007 · Click ingestion"],
  ["0008-deep-links.md", "0008 · Deep links"],
  ["0009-analytics-viewer-tokens.md", "0009 · Viewer tokens"],
  ["0010-conversion-attribution.md", "0010 · Conversion attribution"],
  ["0011-rules-engine.md", "0011 · Rules engine"],
  ["0012-slugs.md", "0012 · Slugs"],
];

/**
 * The changelog page, and the README's "Project status" section (which links to it), exist once
 * the first release has written CHANGELOG.md.
 */
const hasChangelog = existsSync(join(repoRoot, "CHANGELOG.md"));
const changelog: Item[] = hasChangelog
  ? [
      {
        slug: "project/status",
        src: "README.md",
        sections: ["Project status"],
        title: "Project status",
        label: "Project status",
      },
      { slug: "project/changelog", src: "CHANGELOG.md", label: "Changelog" },
    ]
  : [];

export const sidebar: Item[] = [
  {
    label: "Start here",
    items: [
      { slug: "getting-started", src: "docs/GETTING_STARTED.md", label: "Getting started" },
      {
        slug: "guides/why",
        src: "README.md",
        sections: ["Why another link shortener?", "How it works — two planes"],
        title: "Why @xtandard/links",
        label: "Why & how it works",
      },
      {
        slug: "guides/quickstart",
        src: "README.md",
        sections: ["Quickstart", "Create your first link"],
        title: "Quickstart: mount, create, redirect",
        label: "Quickstart",
      },
      {
        slug: "guides/tour",
        src: "README.md",
        sections: [
          "Targeting rules and A/B tests",
          "Click analytics",
          "Conversion attribution",
          "Deep links",
          "The analytics widget",
        ],
        title: "A tour of the features",
        label: "Feature tour",
      },
      { slug: "guides/examples", src: "examples/README.md", label: "Examples" },
      {
        slug: "guides/subpath-exports",
        src: "README.md",
        sections: ["Subpath exports"],
        title: "Subpath exports",
        label: "Subpath exports",
      },
    ],
  },
  {
    label: "Concepts",
    items: [
      { slug: "concepts/architecture", src: "docs/ARCHITECTURE.md", label: "Architecture" },
      { slug: "concepts/links", src: "docs/LINKS.md", label: "Links & domains" },
      { slug: "concepts/rules", src: "docs/RULES.md", label: "Targeting rules" },
      { slug: "concepts/hooks", src: "docs/HOOKS.md", label: "Hooks & the click tap" },
    ],
  },
  {
    label: "Analytics & attribution",
    items: [
      { slug: "analytics", src: "docs/ANALYTICS.md", label: "Click analytics" },
      { slug: "analytics/conversions", src: "docs/CONVERSIONS.md", label: "Conversions" },
      { slug: "analytics/deep-links", src: "docs/DEEP_LINKS.md", label: "Deep links" },
    ],
  },
  {
    label: "Storage & frameworks",
    items: [
      { slug: "storage", src: "docs/STORAGE.md", label: "Storage" },
      { slug: "integrations/adapters", src: "docs/ADAPTERS.md", label: "Framework adapters" },
      { slug: "integrations/http-api", src: "docs/HTTP_API.md", label: "HTTP API" },
    ],
  },
  {
    label: "Access control",
    items: [
      { slug: "security/auth", src: "docs/AUTH.md", label: "Authentication" },
      { slug: "security/authorization", src: "docs/AUTHORIZATION.md", label: "Authorization" },
    ],
  },
  {
    label: "UI",
    items: [
      { slug: "ui/widget", src: "docs/WIDGET.md", label: "Analytics widget" },
      { slug: "ui/admin", src: "docs/UI.md", label: "Admin UI & React embeds" },
      {
        slug: "ui/screenshots",
        src: "README.md",
        sections: ["Screenshots"],
        title: "Screenshots",
        label: "Screenshots",
      },
    ],
  },
  {
    label: "Operations",
    items: [
      { slug: "operations/deployment", src: "docs/DEPLOYMENT.md", label: "Deployment" },
      { slug: "operations/cli", src: "docs/CLI.md", label: "CLI" },
      { slug: "operations/testing", src: "docs/TESTING.md", label: "Testing" },
    ],
  },
  // starlight-typedoc's "API reference" group is inserted here by astro.config.ts.
  {
    label: "Project",
    items: [
      {
        slug: "project/ecosystem",
        src: "README.md",
        sections: ["The xtandard ecosystem"],
        title: "The xtandard ecosystem",
        label: "xtandard ecosystem",
      },
      ...changelog,
      { slug: "project/landscape", src: "docs/research/landscape.md", label: "The landscape" },
      {
        label: "Architecture decisions",
        collapsed: true,
        items: adrs.map(([file, label]) => ({
          slug: `project/adr/${file.slice(0, 4)}`,
          src: `docs/ADR/${file}`,
          label,
        })),
      },
      { slug: "project/brand", src: "docs/BRAND.md", label: "Brand", internal: true },
      { slug: "project/releases", src: "docs/RELEASES.md", label: "Releases", internal: true },
      { label: "npm", link: npmUrl },
    ],
  },
];

export const isPage = (i: Item): i is Page => "slug" in i;
export const isGroup = (i: Item): i is Group => "items" in i;

/** Every page, the home page first. */
export function pages(): Page[] {
  const out: Page[] = [home];
  const walk = (items: Item[]) => {
    for (const i of items) {
      if (isPage(i)) out.push(i);
      else if (isGroup(i)) walk(i.items);
    }
  };
  walk(sidebar);
  return out;
}
