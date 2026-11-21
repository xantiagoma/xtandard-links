/**
 * `@xtandard/links` — self-hosted, embeddable branded short links: a
 * memory-first redirect plane, click analytics, conversion attribution and
 * deep links over the storage you already run.
 *
 * The root export: the core and its types (also on `/core` and `/schema`), the
 * redirect handler and resolver (also on `/redirect`), click enrichment (bots,
 * user agents, geo, privacy), the analytics sink contract and KV rollup sink,
 * rules, deep-link helpers, the hooks contract and the storage contract, the
 * admin panel handler (`createFetchHandler`), analytics viewer tokens and the
 * auth/authorization contracts.
 * Storage drivers, analytics adapters, auth providers, framework adapters and
 * the React embeds are separate subpaths with optional peer dependencies.
 *
 * Import from `@xtandard/links`.
 *
 * @module links
 */

export * from "./schema.ts";
export * from "./core.ts";
export * from "./redirect.ts";
export * from "./resolver.ts";
export * from "./rules.ts";
export * from "./destination.ts";
export * from "./deeplinks.ts";
export * from "./analytics/contract.ts";
export {
  createKvAnalytics,
  UnsupportedQueryError,
  type KvAnalytics,
  type KvAnalyticsOptions,
  type RollupBucket,
} from "./analytics/kv.ts";
export { isBot, isPreviewBot } from "./clicks/bots.ts";
export { parseUserAgent, type ParsedUserAgent, type UserAgentParser } from "./clicks/useragent.ts";
export {
  clientIp,
  cloudflareGeo,
  continentOf,
  edgeHeadersGeo,
  headerGeo,
  normalizeGeo,
  vercelGeo,
  type GeoResolver,
  type HeaderGeoOptions,
} from "./clicks/geo.ts";
export {
  dailySalt,
  optedOut,
  protectIp,
  truncateIp,
  visitorHash,
  type PrivacyOptions,
} from "./clicks/privacy.ts";
export {
  createClickIngestor,
  type ClickIngestor,
  type ClickIngestorOptions,
  type WaitUntil,
} from "./clicks/ingestor.ts";
export {
  HookDeniedError,
  defaultHookErrorReporter,
  normalizeHooks,
  runAfter,
  runBefore,
  type AfterEvent,
  type AfterEventType,
  type BeforeEvent,
  type BeforeEventType,
  type HookErrorReporter,
  type LinksHooks,
  type LinksHooksInput,
} from "./hooks/contract.ts";
export {
  DEFAULT_RESERVED_SLUGS,
  DEFAULT_SLUG_LENGTH,
  MAX_SLUG_LENGTH,
  SLUG_ALPHABET,
  generateSlug,
  slugKey,
  slugProblem,
} from "./slug.ts";
export { hashPassword, verifyPassword } from "./password.ts";
export { newId, idPattern, idTime, type IdPrefix } from "./id.ts";
export { durationToMs } from "./duration.ts";
export * as keys from "./keys.ts";
export { VERSION } from "./version.ts";
export {
  isCompareAndSwap,
  isTransactional,
  isWatchable,
  requirePeer,
  type CompareAndSwapLinksStorage,
  type LinksStorage,
  type StorageChangeEvent,
  type TransactionalLinksStorage,
  type WatchableLinksStorage,
} from "./storage/contract.ts";
export {
  pgListenNotify,
  withWatch,
  type PgNotificationClient,
  type WatchSubscribe,
} from "./storage/watch.ts";
export {
  HOSTNAME_REGEX,
  KEY_REGEX,
  ValidationError,
  assertValid,
  validateDestinationUrl,
  validateDomainInput,
  validateLinkInput,
  validateTenantInput,
  type UrlPolicyOptions,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.ts";

// Auth & authorization contracts (implement your own; providers live behind
// the auth/* and authorization/* subpath exports)
export type { AuthProvider, Principal } from "./auth/contract.ts";
export type {
  AuthorizationProvider,
  AuthorizeInput,
  LinksAction,
  LinksResource,
} from "./authorization/contract.ts";
export { isMutatingAction, MUTATING_ACTIONS } from "./authorization/contract.ts";

// Analytics viewer tokens (mint server-side, verify in the panel handler)
export {
  createViewerToken,
  DEFAULT_VIEWER_ACTIONS,
  DEFAULT_VIEWER_TOKEN_EXPIRES_IN,
  VIEWER_GRANTABLE_ACTIONS,
  VIEWER_TOKEN_PREFIX,
  ViewerTokenError,
  verifyViewerToken,
  type ViewerTokenClaims,
  type ViewerTokenOptions,
} from "./portal.ts";

// The admin panel handler (framework adapters wrap this)
export { createFetchHandler } from "./server/create-fetch-handler.ts";
export type { CreateFetchHandlerResult, LinksPanelOptions } from "./server/create-fetch-handler.ts";
export type { LinksCorsOptions } from "./server/create-fetch-handler.ts";
export type { LinksPortalOptions } from "./server/routes.ts";
export { buildOpenApiDocument } from "./server/openapi.ts";
export type { OpenApiOptions } from "./server/openapi.ts";
