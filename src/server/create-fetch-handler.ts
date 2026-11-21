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

import {
  createPanelHandler,
  requireOneOf,
  resolveUiDir,
  type CorsOptions,
} from "@xtandard/kit/server";
import type { AnalyticsSink } from "../analytics/contract.ts";
import type { AuthProvider } from "../auth/contract.ts";
import type { AuthorizationProvider } from "../authorization/contract.ts";
import { createLinksCore, type LinksCore, type LinksCoreOptions } from "../core.ts";
import type { HookErrorReporter, LinksHooksInput } from "../hooks/contract.ts";
import type { LinksStorage } from "../storage/contract.ts";
import { VERSION } from "../version.ts";
import { buildOpenApiDocument } from "./openapi.ts";
import { createApiHandler, type ApiContext, type LinksPortalOptions } from "./routes.ts";

/**
 * CORS for the panel: `origin` (a string, a list, or a predicate; `"*"` with
 * `credentials` echoes the caller's origin), `credentials`, `methods`,
 * `headers` and `maxAge`.
 */
export type LinksCorsOptions = CorsOptions;

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
  /** Release the panel (idempotent). The links panel runs no background work, so it is a no-op. */
  close(): Promise<void>;
}

// Anonymous defaults keep embedded usage zero-config; harden via auth/authorization.
const defaultAuth: AuthProvider = { authenticate: async () => ({ id: "anonymous" }) };
const defaultAuthorization: AuthorizationProvider = { authorize: async () => true };

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
  const readonly = options.readonly ?? false;
  const title = options.title ?? "@xtandard/links";

  // Either a prebuilt `core` or a `storage` to build one from is required.
  requireOneOf("createFetchHandler", options, ["storage", "core"]);

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

  let api: ((request: Request, path: string) => Promise<Response | null>) | undefined;
  const panel = createPanelHandler({
    basePath: options.basePath,
    title,
    readonly,
    globalName: "__LINKS_CONFIG__",
    uiDir: options.uiDir ?? resolveUiDir(import.meta.url),
    ...(options.logoUrl !== undefined ? { logoUrl: options.logoUrl } : {}),
    ...(options.cors ? { cors: options.cors } : {}),
    // The links API answers `/healthcheck` itself, with `{ status, version }`.
    healthcheck: false,
    api: (request, path) => api!(request, path),
    bootstrap: () => ({ readonly: readonly || core.readonly, version: VERSION }),
  });
  const { basePath } = panel;

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
  api = createApiHandler(apiCtx);

  return {
    fetch: panel.fetch,
    core,
    openapi: () => buildOpenApiDocument({ basePath, title }),
    close: panel.close,
  };
}

export type { LinksPortalOptions };
