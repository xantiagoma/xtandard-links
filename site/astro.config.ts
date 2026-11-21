// The documentation site, on @xtandard/kit/site: Starlight over the repository's Markdown
// (scripts/sync.ts copies it into src/content/docs/ first), a TypeDoc API reference with one module
// per `exports` entry, and Mermaid diagrams. manifest.ts holds the information architecture.
// `bun run build` writes dist/ here; pages.yml publishes it.
import { defineXtandardSite } from "@xtandard/kit/site";
import { manifest } from "./manifest.ts";

export default await defineXtandardSite({
  manifest,
  description:
    "Self-hosted, embeddable branded short links: memory-first redirects, click analytics, conversion attribution and deep links, as a library.",
  tagline: "Self-hosted, embeddable branded short links",
  // Entry points other entry points re-export from; the API reference documents those symbols
  // there. The root (src/index.ts) re-exports /schema, /core, /redirect, /deeplinks and the KV
  // rollup sink (/analytics/kv), so those come first and the root owns only what is its own (the
  // resolver, rules, click enrichment, the sink contract, hooks, viewer tokens, the panel handler…).
  apiOwners: [
    "src/schema.ts",
    "src/core.ts",
    "src/redirect.ts",
    "src/deeplinks.ts",
    "src/entry-analytics-kv.ts",
    "src/index.ts",
  ],
  devPort: 4331,
});
