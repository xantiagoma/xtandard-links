/**
 * Renders the SPA `index.html`: injects a `<base>` tag so relative asset URLs
 * resolve under any mount path, and a bootstrap `window.__LINKS_CONFIG__`
 * blob. Falls back to a minimal built-in page when the UI bundle is absent
 * (e.g. before `bun run build:ui`, or in headless tests).
 *
 * @module
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Bootstrap config injected into the page (the public subset of `/config`). */
export interface BootstrapConfig {
  title: string;
  basePath: string;
  readonly: boolean;
  /** Optional logo image URL shown in the navbar in place of the title wordmark. */
  logoUrl?: string;
  version: string;
}

const escapeJson = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Build the `<base href>` value (always ends in `/`). */
function baseHref(basePath: string): string {
  return basePath === "" ? "/" : `${basePath}/`;
}

function injectInto(html: string, config: BootstrapConfig): string {
  const tags =
    `<base href="${escapeHtml(baseHref(config.basePath))}">` +
    `<script>window.__LINKS_CONFIG__=${escapeJson(config)}</script>`;
  if (html.includes("<head>")) return html.replace("<head>", `<head>${tags}`);
  return tags + html;
}

/** Minimal page served when no built UI is present. */
function fallbackHtml(config: BootstrapConfig): string {
  const title = escapeHtml(config.title);
  const code = "background:#1a1a1a;padding:2px 6px;border-radius:4px";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${escapeHtml(
    baseHref(config.basePath),
  )}"><title>${title}</title><script>window.__LINKS_CONFIG__=${escapeJson(
    config,
  )}</script></head><body style="font-family:system-ui;margin:0;padding:3rem;background:#0a0a0a;color:#e5e5e5"><h1 style="margin:0 0 .5rem">${title}</h1><p style="color:#a3a3a3">The admin UI bundle is not built. Run <code style="${code}">bun run build:ui</code>. The JSON API at <code style="${code}">api/</code> is fully available (<a style="color:#2dd4bf" href="api/openapi.json">OpenAPI</a>).</p></body></html>`;
}

/** Read, inject into, and return the SPA index HTML (or a fallback). */
export async function renderIndexHtml(uiDir: string, config: BootstrapConfig): Promise<string> {
  try {
    const html = await readFile(join(uiDir, "index.html"), "utf8");
    return injectInto(html, config);
  } catch {
    return fallbackHtml(config);
  }
}
