/**
 * The admin panel (ADR 0004): a web-standard fetch handler at the heart of
 * every framework adapter and the standalone app. Composes auth/authorization
 * (plus analytics viewer-token scoping), the JSON admin API, static-asset
 * serving and the SPA fallback into a single
 * `(request: Request) => Promise<Response>`.
 *
 * The redirect plane is separate (`createRedirectHandler`); share one core
 * between them by passing `core: panel.core` to the redirect handler.
 *
 * @module
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AnalyticsSink } from "../analytics/contract.ts";
import type { AuthProvider } from "../auth/contract.ts";
import type { AuthorizationProvider } from "../authorization/contract.ts";
import { createLinksCore, type LinksCore, type LinksCoreOptions } from "../core.ts";
import type { HookErrorReporter, LinksHooksInput } from "../hooks/contract.ts";
import type { LinksStorage } from "../storage/contract.ts";
import { VERSION } from "../version.ts";
import { normalizeBasePath, stripBasePath } from "./base-path.ts";
import { applyCorsHeaders, preflightResponse, type LinksCorsOptions } from "./cors.ts";
import { buildOpenApiDocument } from "./openapi.ts";
import { renderIndexHtml } from "./render-index-html.ts";
import { createApiHandler, type ApiContext, type LinksPortalOptions } from "./routes.ts";
import { looksLikeAsset, serveStaticAsset } from "./static-assets.ts";

/** Options for the panel handler (shared by every framework adapter). */
export interface LinksPanelOptions {
  /** Links storage. Required unless a prebuilt `core` is supplied. */
  storage?: LinksStorage;
  /** Reuse an existing core (e.g. the one your redirect handler uses). */
  core?: LinksCore;
  /** Analytics sink when no `core` is given. Default: KV rollups in `storage`. */
  analytics?: AnalyticsSink;
  /** Shared default domain when no `core` is given (e.g. `"go.acme.com"`). */
  defaultDomain?: string;
  /** Extra core options when no `core` is given (slugs, attribution window, …). */
  coreOptions?: Omit<
    LinksCoreOptions,
    "storage" | "analytics" | "defaultDomain" | "readonly" | "hooks" | "onHookError"
  >;
  /** Mount prefix, e.g. `"/links"`. Default `""` (root). */
  basePath?: string;
  /** Authentication provider. Default: anonymous (no auth). */
  auth?: AuthProvider;
  /** Authorization provider. Default: allow all. */
  authorization?: AuthorizationProvider;
  /**
   * Analytics viewer tokens (ADR 0009): requests bearing a valid `lvt_…` token
   * act as a viewer principal force-scoped to the token's tenant, link set and
   * actions. Mint tokens with `createViewerToken` or
   * `POST /api/tenants/:tenant/viewer-tokens`.
   */
  portal?: LinksPortalOptions;
  /** Block all mutating operations when true. */
  readonly?: boolean;
  /** UI title shown in the page and bootstrap config. */
  title?: string;
  /** Logo image URL shown in the navbar in place of the title wordmark. */
  logoUrl?: string;
  /** Override the directory the bundled UI is served from (defaults to `./ui` beside this module). */
  uiDir?: string;
  /** Control-plane hooks fired around admin mutations. Ignored when `core` is supplied. */
  hooks?: LinksHooksInput;
  /** Reporter for errors thrown by `after` hooks. Ignored when `core` is supplied. */
  onHookError?: HookErrorReporter;
  /**
   * Path prefix the redirect handler serves links under (its `basePath`, e.g.
   * `"/l"`), so QR codes encode the right short URL. Default: links at the root.
   */
  redirectBasePath?: string;
  /**
   * Enable CORS on the handler itself — answers `OPTIONS` preflights and attaches
   * `Access-Control-*` headers to every response, so a cross-origin embed works
   * regardless of the host framework. See {@link LinksCorsOptions}.
   */
  cors?: LinksCorsOptions;
}

/** Return shape of {@link createFetchHandler}. */
export interface CreateFetchHandlerResult {
  /** Web-standard request handler. */
  fetch(request: Request): Promise<Response>;
  /** The underlying core (share it with `createRedirectHandler({ core })`). */
  core: LinksCore;
  /**
   * The admin API as an OpenAPI 3.1 document (also served at `{basePath}/api/openapi.json`).
   * Merge it into your host app's docs.
   */
  openapi(): Record<string, unknown>;
}

// Anonymous defaults keep embedded usage zero-config; harden via auth/authorization.
const defaultAuth: AuthProvider = { authenticate: async () => ({ id: "anonymous" }) };
const defaultAuthorization: AuthorizationProvider = { authorize: async () => true };

/**
 * Locate the built admin SPA (`dist/ui`): beside the compiled module, or at
 * `<repo>/dist/ui` when running from TypeScript source. Falls back to the
 * compiled-layout path so the "build the UI" placeholder still renders.
 */
function defaultUiDir(): string {
  try {
    const candidates = [
      new URL("./ui", import.meta.url), // compiled: dist/<chunk>.mjs → dist/ui
      new URL("../../dist/ui", import.meta.url), // source: src/server/*.ts → <repo>/dist/ui
    ].map((u) => fileURLToPath(u));
    return candidates.find((p) => existsSync(p)) ?? (candidates[0] as string);
  } catch {
    return "./ui";
  }
}

/**
 * Build the panel fetch handler.
 *
 * @example
 * ```ts
 * import { createFetchHandler, createRedirectHandler } from "@xtandard/links";
 * import { createFileStorage } from "@xtandard/links/storage/file";
 *
 * const panel = createFetchHandler({
 *   storage: createFileStorage({ dir: "./data/links" }),
 *   basePath: "/links",
 *   defaultDomain: "go.acme.com",
 * });
 * const redirects = createRedirectHandler({ core: panel.core });
 *
 * Bun.serve({
 *   fetch: async (req) => (await redirects.handle(req)) ?? panel.fetch(req),
 * });
 * ```
 */
export function createFetchHandler(options: LinksPanelOptions): CreateFetchHandlerResult {
  const basePath = normalizeBasePath(options.basePath);
  const readonly = options.readonly ?? false;
  const title = options.title ?? "@xtandard/links";
  const uiDir = options.uiDir ?? defaultUiDir();

  if (!options.core && !options.storage) {
    throw new Error("createFetchHandler requires either `storage` or a prebuilt `core`. Pass one.");
  }

  const core =
    options.core ??
    createLinksCore({
      ...options.coreOptions,
      storage: options.storage as LinksStorage,
      readonly,
      ...(options.analytics ? { analytics: options.analytics } : {}),
      ...(options.defaultDomain ? { defaultDomain: options.defaultDomain } : {}),
      ...(options.hooks !== undefined ? { hooks: options.hooks } : {}),
      ...(options.onHookError ? { onHookError: options.onHookError } : {}),
    });

  const apiCtx: ApiContext = {
    core,
    auth: options.auth ?? defaultAuth,
    authorization: options.authorization ?? defaultAuthorization,
    title,
    readonly,
    basePath,
    ...(options.logoUrl !== undefined ? { logoUrl: options.logoUrl } : {}),
    ...(options.portal ? { portal: options.portal } : {}),
    ...(options.redirectBasePath ? { redirectBasePath: options.redirectBasePath } : {}),
  };
  const api = createApiHandler(apiCtx);
  const cors = options.cors;

  async function fetch(request: Request): Promise<Response> {
    // CORS preflight: answer OPTIONS directly so it works for any path,
    // independent of the host framework wrapping this handler.
    if (cors && request.method === "OPTIONS") return preflightResponse(request, cors);
    const response = await respond(request);
    return cors ? applyCorsHeaders(request, response, cors) : response;
  }

  async function respond(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = stripBasePath(url.pathname, basePath);

    // 1. JSON API + bootstrap config.
    const apiResponse = await api(request, path);
    if (apiResponse) return apiResponse;

    // 2. Only GET/HEAD reach the static UI.
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // 3. Static asset.
    const asset = await serveStaticAsset(uiDir, path);
    if (asset) return asset;

    // 4. A path that looks like a file but was not found → 404 (don't mask with the SPA).
    if (path !== "/" && looksLikeAsset(path)) {
      return new Response("Not Found", { status: 404 });
    }

    // 5. SPA fallback.
    const html = await renderIndexHtml(uiDir, {
      title,
      basePath,
      readonly: readonly || core.readonly,
      version: VERSION,
      ...(options.logoUrl !== undefined ? { logoUrl: options.logoUrl } : {}),
    });
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
    });
  }

  return { fetch, core, openapi: () => buildOpenApiDocument({ basePath, title }) };
}

export type { LinksPortalOptions };
