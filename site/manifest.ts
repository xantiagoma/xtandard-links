// The site's information architecture: which repository Markdown becomes which page, and the
// sidebar tree (see `defineSiteManifest` in @xtandard/kit/site). scripts/sync.ts and
// astro.config.ts both read it, so a page and its sidebar entry cannot drift.
//
// The Markdown in the repository (README.md, docs/*.md) stays the single source of truth: it is
// what GitHub and npm render. A page is a whole repository file (`src`), some H2 sections of one
// (`src` + `sections`, optionally `intro`; every H2 of a split file other than the README must land
// on exactly one page), or a page written for the site only (`site`, relative to site/content/).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineSiteManifest, type SiteItem } from "@xtandard/kit/site";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

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
const changelog: SiteItem[] = hasChangelog
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

const sidebar: SiteItem[] = [
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
      { label: "npm", link: "https://www.npmjs.com/package/@xtandard/links" },
    ],
  },
];

export const manifest = defineSiteManifest({
  repoRoot,
  repoSlug: "xantiagoma/xtandard-links",
  packageName: "@xtandard/links",
  rootModule: "links",
  base: "/xtandard-links",
  sidebar,
});
