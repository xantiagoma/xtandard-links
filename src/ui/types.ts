/**
 * Wire types for the admin SPA. The domain types come straight from the
 * package (type-only imports — erased from the bundle); this file adds the
 * HTTP-level shapes the panel API returns (`/config`, pages, errors).
 *
 * @module
 */

import type {
  AnalyticsBreakdownRow,
  AnalyticsBucket,
  AnalyticsCapabilities,
  AnalyticsDimension,
  AnalyticsInterval,
  AnalyticsMetrics,
  AnalyticsResult,
} from "../analytics/contract.ts";
import type {
  AnalyticsEvent,
  AuditEntry,
  ClickEvent,
  Condition,
  ConditionField,
  Customer,
  Domain,
  LeadEvent,
  Link,
  LinkRule,
  QueryCondition,
  RedirectStatus,
  SaleEvent,
  Tenant,
  TimeCondition,
  Utm,
  ValueCondition,
  Variant,
} from "../schema.ts";

export type {
  AnalyticsBreakdownRow,
  AnalyticsBucket,
  AnalyticsCapabilities,
  AnalyticsDimension,
  AnalyticsEvent,
  AnalyticsInterval,
  AnalyticsMetrics,
  AnalyticsResult,
  AuditEntry,
  ClickEvent,
  Condition,
  ConditionField,
  Customer,
  Domain,
  LeadEvent,
  LinkRule,
  QueryCondition,
  RedirectStatus,
  SaleEvent,
  Tenant,
  TimeCondition,
  Utm,
  ValueCondition,
  Variant,
};

/** A link as the API returns it: the password verifier is replaced by a flag. */
export type PublicLink = Omit<Link, "password"> & { hasPassword: boolean };

/** Actions a viewer token may carry (ADR 0009). */
export type ViewerAction = "analytics:read" | "link:read" | "link:create" | "link:update" | string;

/** `GET /config` — bootstrap and capability flags for the shell. */
export interface LinksConfig {
  title: string;
  logoUrl?: string;
  basePath: string;
  readonly: boolean;
  authenticated?: boolean;
  principal?: { id: string; email?: string; name?: string; roles?: string[] } | null;
  /** The request carries an analytics viewer token: render the widget chrome. */
  viewer: boolean;
  /** Viewer only: the token's tenant. */
  tenant?: string;
  /** Viewer only: the token's link scope, when restricted. */
  links?: string[];
  /** Viewer only: granted actions. */
  allow?: ViewerAction[];
  /** Viewer only: token expiry. */
  expiresAt?: string;
  /** Viewer tokens can be minted (`portal.secret` configured). */
  viewerTokens?: boolean;
  capabilities: AnalyticsCapabilities;
  version: string;
}

/** `GET /api/tenants/:tenant/links`. */
export interface LinkPage {
  links: PublicLink[];
  total: number;
  nextCursor?: string;
}

/** Per-row outcome of an import. */
export interface ImportRowResult {
  index: number;
  status: "created" | "updated" | "skipped" | "error";
  link?: PublicLink;
  /** The parsed row (dry runs carry no saved link). */
  input?: { url?: string; domain?: string; slug?: string; title?: string };
  error?: string;
}

/** `POST /api/tenants/:tenant/links/import`. */
export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  rows: ImportRowResult[];
}

/** Error body every non-2xx JSON response carries. */
export interface ApiErrorBody {
  error: string;
  errors?: { path: string; message: string }[];
  code?: string;
}

/** Thrown by the API client for non-2xx responses. */
export class LinksApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(body.error || `HTTP ${status}`);
    this.name = "LinksApiError";
  }
}

/** A user-facing message for any thrown value (API errors include field issues). */
export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof LinksApiError) {
    const issues = err.body.errors?.map((e) => `${e.path}: ${e.message}`).join("; ");
    return issues ? `${err.body.error} — ${issues}` : err.body.error || fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
