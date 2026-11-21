/**
 * The links control plane: tenants, domains, links, slugs, bulk import,
 * conversions, deferred deep links and the operator audit log — over any
 * {@link LinksStorage}, with analytics through an {@link AnalyticsSink}.
 *
 * The redirect plane (`createRedirectHandler`) reads through a memory-first
 * resolver on top of this core; nothing here is on the per-request hot path
 * except the batched click counters.
 *
 * Import from `@xtandard/links/core` (also re-exported by the root).
 *
 * @module core
 */

import type { AnalyticsQuery, AnalyticsResult, AnalyticsSink } from "./analytics/contract.ts";
import { createKvAnalytics } from "./analytics/kv.ts";
import { durationToMs } from "./duration.ts";
import {
  defaultHookErrorReporter,
  normalizeHooks,
  runAfter,
  runBefore,
  type AfterEvent,
  type BeforeEvent,
  type HookErrorReporter,
  type LinksHooksInput,
} from "./hooks/contract.ts";
import { newId } from "./id.ts";
import * as keys from "./keys.ts";
import { hashPassword } from "./password.ts";
import {
  DEFAULT_TENANT,
  type Actor,
  type AuditEntry,
  type ClickRef,
  type Customer,
  type DeferredHandoff,
  type Domain,
  type JsonObject,
  type LeadEvent,
  type Link,
  type LinkRule,
  type LinksDuration,
  type SaleEvent,
  type SlugPointer,
  type Tenant,
} from "./schema.ts";
import { DEFAULT_RESERVED_SLUGS, DEFAULT_SLUG_LENGTH, generateSlug, slugKey } from "./slug.ts";
import { isCompareAndSwap, type LinksStorage } from "./storage/contract.ts";
import {
  assertValid,
  validateDomainInput,
  validateKeySegment,
  validateLinkInput,
  validateTenantInput,
  ValidationError,
  type UrlPolicyOptions,
} from "./validation.ts";

/** Thrown by mutating operations when the core is in readonly mode. */
export class ReadonlyError extends Error {
  constructor(operation: string) {
    super(`Cannot ${operation}: @xtandard/links is in readonly mode.`);
    this.name = "ReadonlyError";
  }
}

/** Thrown when a referenced tenant/domain/link does not exist. Maps to HTTP 404. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Thrown when a slug, external id or hostname is already taken. Maps to HTTP 409. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** Options accepted by mutating calls. */
export interface ActorOptions {
  actor?: Actor | null;
}

/** Input for {@link LinksCore.createLink}. Everything but `url` is optional. */
export interface CreateLinkInput {
  /** Default {@link DEFAULT_TENANT}. */
  tenant?: string;
  /** Default: the tenant's default domain, then the shared default domain. */
  domain?: string;
  /** Default: generated (ADR 0012). */
  slug?: string;
  url: string;
  title?: string | null;
  description?: string | null;
  tags?: string[];
  externalId?: string | null;
  expiresAt?: string | null;
  expiredUrl?: string | null;
  maxClicks?: number | null;
  /** Plain-text password; stored as a PBKDF2 hash. */
  password?: string | null;
  utm?: Link["utm"] | null;
  preview?: Link["preview"] | null;
  /** Rule ids are generated when omitted. */
  rules?: (Omit<LinkRule, "id"> & { id?: string })[];
  ios?: string | null;
  android?: string | null;
  deepLink?: Link["deepLink"] | null;
  redirectStatus?: Link["redirectStatus"] | null;
  trackConversions?: boolean;
  passQuery?: boolean;
  indexable?: boolean;
  disabled?: boolean;
  archived?: boolean;
  metadata?: JsonObject | null;
}

/** Input for {@link LinksCore.updateLink}: any subset; `null` clears a field. */
export type UpdateLinkInput = Partial<Omit<CreateLinkInput, "tenant">>;

/** Query for {@link LinksCore.listLinks}. */
export interface ListLinksQuery {
  /** Case-insensitive match on slug, URL, title, tags and domain. */
  search?: string;
  tag?: string;
  domain?: string;
  /** `false` (default) hides archived links, `true` shows only archived, `"all"` shows both. */
  archived?: boolean | "all";
  /** Page size, default 50, max 500. */
  limit?: number;
  /** Return links older than this id (the previous page's `nextCursor`). */
  cursor?: string;
}

/** A page of links. */
export interface LinkPage {
  links: Link[];
  /** Total matching links (before paging). */
  total: number;
  nextCursor?: string;
}

/** How {@link LinksCore.importLinks} treats rows whose slug or external id exists. */
export type ImportConflictPolicy = "skip" | "update" | "error";

/** One row's outcome in an import. */
export interface ImportRowResult {
  index: number;
  status: "created" | "updated" | "skipped" | "error";
  link?: Link;
  error?: string;
}

/** Result of {@link LinksCore.importLinks}. */
export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  rows: ImportRowResult[];
}

/** Input for {@link LinksCore.trackLead}. */
export interface TrackLeadInput {
  tenant?: string;
  /** The click id from the destination URL / `xl_id` cookie. Optional when the customer is known. */
  clickId?: string;
  /** The host's customer id. */
  customerId: string;
  /** Event name. Default `"Sign up"`. */
  name?: string;
  customerName?: string;
  customerEmail?: string;
  metadata?: JsonObject;
  /** Event time, default now. */
  at?: string;
}

/** Input for {@link LinksCore.trackSale}. */
export interface TrackSaleInput {
  tenant?: string;
  customerId: string;
  /** Minor units (cents). */
  amount: number;
  /** ISO 4217. Default `"USD"`. */
  currency?: string;
  /** Idempotency: a second sale with the same invoice id is ignored. */
  invoiceId?: string;
  /** Event name. Default `"Purchase"`. */
  name?: string;
  /** Attribute to this click when the customer has none yet. */
  clickId?: string;
  metadata?: JsonObject;
  at?: string;
}

/** Result of a conversion call; `null` when the click/customer is unknown. */
export interface ConversionResult<E> {
  event: E;
  customer: Customer;
  /** True when an idempotent repeat (same invoice id) was ignored. */
  duplicate?: boolean;
}

/** A change notification for resolver caches. */
export interface LinkChange {
  type: "link" | "domain";
  hostname: string;
  /** Normalized slug key (links only). */
  slugKey?: string;
}

/** Options for {@link createLinksCore}. */
export interface LinksCoreOptions {
  storage: LinksStorage;
  /** Analytics sink. Default: KV rollups in `storage` (`createKvAnalytics`). */
  analytics?: AnalyticsSink;
  hooks?: LinksHooksInput;
  onHookError?: HookErrorReporter;
  /** Block all mutations. */
  readonly?: boolean;
  /** Clock (epoch millis). */
  now?: () => number;
  /**
   * A shared domain registered automatically on first use and used when a
   * link names no domain, e.g. `"go.acme.com"` or `"localhost"`.
   */
  defaultDomain?: string;
  /** Slugs the redirect handler never serves. Default {@link DEFAULT_RESERVED_SLUGS}. */
  reservedSlugs?: readonly string[];
  /** Allow app-scheme destinations (`myapp://…`). Default `true`. */
  allowAppSchemes?: boolean;
  /** Extra destination URL check (e.g. block-list); return a message to reject. */
  urlPolicy?: UrlPolicyOptions["urlPolicy"];
  /** How long click refs stay claimable for conversions. Default `"90d"`. */
  attributionWindow?: LinksDuration;
  /** Deferred deep-link handoff lifetime. Default `"2h"`. */
  deferredTtl?: LinksDuration;
  /** Max audit entries kept per tenant. Default 1000. */
  auditLogLimit?: number;
  /** Click counter flush interval (ms). Default 2000. */
  counterFlushMs?: number;
}

/** The control plane. */
export interface LinksCore {
  readonly storage: LinksStorage;
  readonly analytics: AnalyticsSink;
  readonly readonly: boolean;
  readonly reservedSlugs: readonly string[];
  /** Deferred deep-link handoff lifetime (ms). */
  readonly deferredTtlMs: number;
  /** The clock, for collaborators (redirect handler, tests). */
  now(): number;

  listTenants(): Promise<Tenant[]>;
  getTenant(key: string): Promise<Tenant | null>;
  upsertTenant(input: Tenant, options?: ActorOptions): Promise<Tenant>;
  /** Delete a tenant and every link it owns. */
  deleteTenant(key: string, options?: ActorOptions): Promise<void>;

  /** All domains, or the ones a tenant may use (shared + its own). */
  listDomains(filter?: { tenant?: string }): Promise<Domain[]>;
  getDomain(hostname: string): Promise<Domain | null>;
  createDomain(input: Domain, options?: ActorOptions): Promise<Domain>;
  updateDomain(
    hostname: string,
    patch: Partial<Omit<Domain, "hostname">>,
    options?: ActorOptions,
  ): Promise<Domain>;
  /** Fails with {@link ConflictError} while links use the domain, unless `force` (deletes them). */
  deleteDomain(hostname: string, options?: ActorOptions & { force?: boolean }): Promise<void>;

  createLink(input: CreateLinkInput, options?: ActorOptions): Promise<Link>;
  getLink(tenant: string, id: string): Promise<Link | null>;
  getLinkByExternalId(tenant: string, externalId: string): Promise<Link | null>;
  /** The redirect lookup: domain + slug (normalized per the domain's case rule). */
  getLinkBySlug(hostname: string, slug: string): Promise<Link | null>;
  listLinks(tenant: string, query?: ListLinksQuery): Promise<LinkPage>;
  updateLink(
    tenant: string,
    id: string,
    patch: UpdateLinkInput,
    options?: ActorOptions,
  ): Promise<Link>;
  deleteLink(tenant: string, id: string, options?: ActorOptions): Promise<Link>;
  listTags(tenant: string): Promise<{ tag: string; count: number }[]>;
  importLinks(
    tenant: string,
    rows: CreateLinkInput[],
    options?: ActorOptions & { dryRun?: boolean; onConflict?: ImportConflictPolicy },
  ): Promise<ImportResult>;

  /** Count a non-bot click (batched, never awaited by the redirect). */
  countClick(tenant: string, linkId: string): void;
  /** Approximate click count (stored + not yet flushed). */
  getClickCount(tenant: string, linkId: string): Promise<number>;
  /** Write pending click counters now. */
  flushCounters(): Promise<void>;

  /** Store a click ref so conversions can be attributed to it. */
  recordClickRef(ref: ClickRef): Promise<void>;
  getClickRef(clickId: string): Promise<ClickRef | null>;
  trackLead(input: TrackLeadInput): Promise<ConversionResult<LeadEvent> | null>;
  trackSale(input: TrackSaleInput): Promise<ConversionResult<SaleEvent> | null>;
  getCustomer(tenant: string, customerId: string): Promise<Customer | null>;
  listCustomers(tenant: string): Promise<Customer[]>;

  /** Store a deferred deep-link handoff (ADR 0008). */
  saveDeferred(handoff: DeferredHandoff, fingerprint?: string): Promise<void>;
  /** Claim a handoff exactly once, by click id (exact) or fingerprint (probabilistic). */
  claimDeferred(input: {
    clickId?: string;
    fingerprint?: string;
  }): Promise<{ handoff: DeferredHandoff; matchType: "exact" | "probabilistic" } | null>;

  listAudit(tenant?: string): Promise<AuditEntry[]>;
  queryAnalytics(query: AnalyticsQuery): Promise<AnalyticsResult>;

  /** Subscribe to link/domain changes made through this core (resolver eviction). */
  onChange(listener: (change: LinkChange) => void): () => void;
  /** Drop expired click refs and deferred handoffs. */
  prune(): Promise<{ clickRefs: number; deferred: number }>;
  /** Flush counters and stop timers. */
  close(): Promise<void>;
}

/** Strip secrets from a link for API responses: the password hash becomes `hasPassword`. */
export function publicLink(link: Link): Omit<Link, "password"> & { hasPassword: boolean } {
  const { password, ...rest } = link;
  return { ...rest, hasPassword: password !== undefined };
}

const nonEmpty = <T>(value: T | null | undefined): value is T =>
  value !== null && value !== undefined;

/** Create the links control plane. */
export function createLinksCore(options: LinksCoreOptions): LinksCore {
  const storage = options.storage;
  const analytics = options.analytics ?? createKvAnalytics({ storage });
  const readonly = options.readonly ?? false;
  const hooks = normalizeHooks(options.hooks);
  const onHookError = options.onHookError ?? defaultHookErrorReporter;
  const now = options.now ?? Date.now;
  const reservedSlugs = options.reservedSlugs ?? DEFAULT_RESERVED_SLUGS;
  const attributionWindowMs = durationToMs(options.attributionWindow ?? "90d");
  const deferredTtlMs = durationToMs(options.deferredTtl ?? "2h");
  const auditLogLimit = options.auditLogLimit ?? 1000;
  const urlOptions: UrlPolicyOptions = {
    ...(options.allowAppSchemes !== undefined ? { allowAppSchemes: options.allowAppSchemes } : {}),
    ...(options.urlPolicy ? { urlPolicy: options.urlPolicy } : {}),
  };
  const defaultDomain = options.defaultDomain?.toLowerCase();
  const listeners = new Set<(change: LinkChange) => void>();

  const nowIso = () => new Date(now()).toISOString();
  const guard = (op: string) => {
    if (readonly) throw new ReadonlyError(op);
  };
  const before = (event: BeforeEvent) => (hooks.length ? runBefore(hooks, event) : undefined);
  const after = (event: AfterEvent) =>
    hooks.length ? runAfter(hooks, event, onHookError) : undefined;
  const emit = (change: LinkChange) => {
    for (const l of listeners) {
      try {
        l(change);
      } catch {
        // listeners never break mutations
      }
    }
  };

  // ---------------------------------------------------------------- helpers

  async function indexAdd(key: string, value: string): Promise<void> {
    const list = (await storage.getItem<string[]>(key)) ?? [];
    if (!list.includes(value)) {
      list.push(value);
      await storage.setItem(key, list);
    }
  }

  async function indexRemove(key: string, value: string): Promise<void> {
    const list = (await storage.getItem<string[]>(key)) ?? [];
    const next = list.filter((x) => x !== value);
    if (next.length !== list.length) await storage.setItem(key, next);
  }

  async function audit(
    tenant: string | null,
    action: string,
    target: string,
    actor: Actor | null | undefined,
    details?: JsonObject,
  ): Promise<void> {
    const key = tenant ? keys.auditLogKey(tenant) : keys.globalAuditLogKey();
    const log = (await storage.getItem<AuditEntry[]>(key)) ?? [];
    log.push({
      at: nowIso(),
      action,
      actor: actor ?? null,
      target,
      ...(details ? { details } : {}),
    });
    await storage.setItem(key, log.slice(-auditLogLimit));
  }

  /** Claim a slug pointer atomically when possible; returns false if taken. */
  async function claimPointer(key: string, pointer: SlugPointer): Promise<boolean> {
    if (isCompareAndSwap(storage)) {
      return storage.compareAndSwap<SlugPointer>({ key, expected: null, next: pointer });
    }
    if (await storage.getItem(key)) return false;
    await storage.setItem(key, pointer);
    const check = await storage.getItem<SlugPointer>(key);
    return check?.id === pointer.id;
  }

  async function ensureTenant(key: string): Promise<void> {
    if (await storage.getItem(keys.tenantKey(key))) return;
    const at = nowIso();
    await storage.setItem<Tenant>(keys.tenantKey(key), { key, createdAt: at, updatedAt: at });
    await indexAdd(keys.tenantsKey(), key);
  }

  async function ensureDefaultDomain(): Promise<void> {
    if (!defaultDomain) return;
    if (await storage.getItem(keys.domainKey(defaultDomain))) return;
    const at = nowIso();
    await storage.setItem<Domain>(keys.domainKey(defaultDomain), {
      hostname: defaultDomain,
      isDefault: true,
      createdAt: at,
      updatedAt: at,
    });
    await indexAdd(keys.domainsKey(), defaultDomain);
  }

  async function pickDomain(tenant: string, requested: string | undefined): Promise<Domain> {
    await ensureDefaultDomain();
    if (requested) {
      const hostname = requested.toLowerCase();
      const domain = await storage.getItem<Domain>(keys.domainKey(hostname));
      if (!domain) throw new NotFoundError(`Domain "${hostname}" is not registered.`);
      if (domain.tenant && domain.tenant !== tenant) {
        throw new ValidationError([
          { path: "link.domain", message: `domain "${hostname}" belongs to another tenant` },
        ]);
      }
      return domain;
    }
    const usable = await listDomains({ tenant });
    const own = usable.find((d) => d.tenant === tenant && d.isDefault);
    const shared = usable.find((d) => !d.tenant && d.isDefault);
    const fallback = own ?? shared ?? (usable.length === 1 ? usable[0] : undefined);
    if (!fallback) {
      throw new ValidationError([
        {
          path: "link.domain",
          message: "is required (no default domain; register one or set `defaultDomain`)",
        },
      ]);
    }
    return fallback;
  }

  function withRuleIds(rules: CreateLinkInput["rules"]): LinkRule[] {
    return (rules ?? []).map((r) => ({
      ...r,
      id: r.id ?? `r_${newId("rule").slice(-8).toLowerCase()}`,
    })) as LinkRule[];
  }

  /** Apply a create/update input onto a link record (nulls clear fields). */
  async function applyInput(target: Link, input: UpdateLinkInput): Promise<void> {
    const record = target as unknown as Record<string, unknown>;
    const simple = [
      "url",
      "title",
      "description",
      "expiresAt",
      "expiredUrl",
      "maxClicks",
      "utm",
      "preview",
      "ios",
      "android",
      "deepLink",
      "redirectStatus",
      "trackConversions",
      "passQuery",
      "indexable",
      "disabled",
      "archived",
      "metadata",
    ] as const;
    for (const field of simple) {
      if (!(field in input)) continue;
      const value = input[field];
      if (value === null || value === undefined) delete record[field];
      else record[field] = value;
    }
    if (input.tags !== undefined) target.tags = [...new Set(input.tags.map((t) => t.trim()))];
    if (input.rules !== undefined) target.rules = withRuleIds(input.rules);
    if ("password" in input) {
      if (input.password === null || input.password === undefined) delete target.password;
      else target.password = await hashPassword(input.password);
    }
  }

  async function readCounter(tenant: string, id: string): Promise<number> {
    return (await storage.getItem<number>(keys.counterKey(tenant, id))) ?? 0;
  }

  // ---------------------------------------------------------------- tenants

  async function listTenants(): Promise<Tenant[]> {
    const index = (await storage.getItem<string[]>(keys.tenantsKey())) ?? [];
    const all = await Promise.all(index.map((k) => storage.getItem<Tenant>(keys.tenantKey(k))));
    return all.filter(nonEmpty).sort((a, b) => a.key.localeCompare(b.key));
  }

  // ---------------------------------------------------------------- domains

  async function listDomains(filter: { tenant?: string } = {}): Promise<Domain[]> {
    await ensureDefaultDomain();
    const index = (await storage.getItem<string[]>(keys.domainsKey())) ?? [];
    const all = (
      await Promise.all(index.map((h) => storage.getItem<Domain>(keys.domainKey(h))))
    ).filter(nonEmpty);
    const scoped =
      filter.tenant === undefined
        ? all
        : all.filter((d) => d.tenant === undefined || d.tenant === filter.tenant);
    return scoped.sort((a, b) => a.hostname.localeCompare(b.hostname));
  }

  async function getDomain(hostname: string): Promise<Domain | null> {
    await ensureDefaultDomain();
    return storage.getItem<Domain>(keys.domainKey(hostname.toLowerCase()));
  }

  // ---------------------------------------------------------------- links

  async function getLink(tenant: string, id: string): Promise<Link | null> {
    return storage.getItem<Link>(keys.linkKey(tenant, id));
  }

  async function requireLink(tenant: string, id: string): Promise<Link> {
    const link = await getLink(tenant, id);
    if (!link) throw new NotFoundError(`Link "${id}" does not exist in tenant "${tenant}".`);
    return link;
  }

  async function createLink(input: CreateLinkInput, opts: ActorOptions = {}): Promise<Link> {
    guard("create a link");
    assertValid(validateLinkInput(input, { mode: "create", reservedSlugs, ...urlOptions }));
    const tenant = input.tenant ?? DEFAULT_TENANT;
    const domain = await pickDomain(tenant, input.domain);
    const caseSensitive = domain.caseSensitive ?? false;
    const at = nowIso();
    const id = newId("lnk", now());

    if (input.externalId) {
      const existing = await storage.getItem<string>(keys.externalIdKey(tenant, input.externalId));
      if (existing && (await getLink(tenant, existing))) {
        throw new ConflictError(`External id "${input.externalId}" is already used.`);
      }
    }

    const link: Link = {
      id,
      tenant,
      domain: domain.hostname,
      slug: input.slug ?? "",
      url: input.url,
      tags: [],
      rules: [],
      createdAt: at,
      updatedAt: at,
      ...(opts.actor ? { createdBy: opts.actor.id } : {}),
    };
    await applyInput(link, input);
    if (input.externalId) link.externalId = input.externalId;

    await before({ type: "link.create", link, actor: opts.actor ?? null });

    // Claim the slug pointer (generated slugs retry, then grow).
    const pointer: SlugPointer = { tenant, id };
    if (input.slug) {
      const claimed = await claimPointer(
        keys.slugKey(domain.hostname, slugKey(input.slug, caseSensitive)),
        pointer,
      );
      if (!claimed) {
        throw new ConflictError(`Slug "${input.slug}" is already taken on ${domain.hostname}.`);
      }
    } else {
      let length = domain.slugLength ?? DEFAULT_SLUG_LENGTH;
      for (let attempt = 0; ; attempt++) {
        const candidate = generateSlug(length, caseSensitive);
        const key = keys.slugKey(domain.hostname, slugKey(candidate, caseSensitive));
        if (await claimPointer(key, pointer)) {
          link.slug = candidate;
          break;
        }
        if (attempt % 5 === 4) length++;
      }
    }

    await ensureTenant(tenant);
    await storage.setItem(keys.linkKey(tenant, id), link);
    if (link.externalId) await storage.setItem(keys.externalIdKey(tenant, link.externalId), id);
    await audit(tenant, "link.created", `link:${id}`, opts.actor, {
      slug: link.slug,
      domain: link.domain,
      url: link.url,
    });
    emit({ type: "link", hostname: link.domain, slugKey: slugKey(link.slug, caseSensitive) });
    await after({ type: "link.created", link, at, actor: opts.actor ?? null });
    return link;
  }

  async function getLinkBySlug(hostname: string, slug: string): Promise<Link | null> {
    const host = hostname.toLowerCase();
    const domain = await storage.getItem<Domain>(keys.domainKey(host));
    const caseSensitive = domain?.caseSensitive ?? false;
    const pointer = await storage.getItem<SlugPointer>(
      keys.slugKey(host, slugKey(slug, caseSensitive)),
    );
    if (!pointer) return null;
    const link = await getLink(pointer.tenant, pointer.id);
    // A pointer whose link vanished (crash mid-delete) is treated as absent.
    return link && link.domain === host ? link : null;
  }

  async function listLinks(tenant: string, query: ListLinksQuery = {}): Promise<LinkPage> {
    const linkKeys = await storage.getKeys(keys.linksPrefix(tenant));
    let links = (await Promise.all(linkKeys.map((k) => storage.getItem<Link>(k)))).filter(nonEmpty);
    const archived = query.archived ?? false;
    if (archived !== "all") links = links.filter((l) => (l.archived ?? false) === archived);
    if (query.tag) links = links.filter((l) => l.tags.includes(query.tag as string));
    if (query.domain) {
      const d = query.domain.toLowerCase();
      links = links.filter((l) => l.domain === d);
    }
    if (query.search) {
      const s = query.search.toLowerCase();
      links = links.filter(
        (l) =>
          l.slug.toLowerCase().includes(s) ||
          l.url.toLowerCase().includes(s) ||
          l.domain.includes(s) ||
          (l.title ?? "").toLowerCase().includes(s) ||
          l.tags.some((t) => t.toLowerCase().includes(s)),
      );
    }
    links.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)); // newest first
    const total = links.length;
    let start = 0;
    if (query.cursor) {
      const cursor = query.cursor;
      start = links.findIndex((l) => l.id < cursor);
      if (start < 0) start = links.length;
    }
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
    const page = links.slice(start, start + limit);
    for (const link of page) link.clicks = await getClickCount(tenant, link.id);
    const last = page[page.length - 1];
    return {
      links: page,
      total,
      ...(start + limit < links.length && last ? { nextCursor: last.id } : {}),
    };
  }

  async function updateLink(
    tenant: string,
    id: string,
    patch: UpdateLinkInput,
    opts: ActorOptions = {},
  ): Promise<Link> {
    guard("update a link");
    assertValid(validateLinkInput(patch, { mode: "update", reservedSlugs, ...urlOptions }));
    const previous = await requireLink(tenant, id);
    const next: Link = structuredClone(previous);
    await applyInput(next, patch);
    next.updatedAt = nowIso();

    // Domain / slug moves.
    const oldDomain = (await storage.getItem<Domain>(keys.domainKey(previous.domain))) ?? {
      hostname: previous.domain,
    };
    const newDomain =
      patch.domain !== undefined && patch.domain !== null
        ? await pickDomain(tenant, patch.domain)
        : oldDomain;
    next.domain = newDomain.hostname;
    if (patch.slug !== undefined && patch.slug !== null) next.slug = patch.slug;
    const oldKey = keys.slugKey(
      previous.domain,
      slugKey(previous.slug, oldDomain.caseSensitive ?? false),
    );
    const newKey = keys.slugKey(next.domain, slugKey(next.slug, newDomain.caseSensitive ?? false));

    if (patch.externalId !== undefined) {
      if (patch.externalId === null) delete next.externalId;
      else if (patch.externalId !== previous.externalId) {
        const taken = await storage.getItem<string>(keys.externalIdKey(tenant, patch.externalId));
        if (taken && taken !== id && (await getLink(tenant, taken))) {
          throw new ConflictError(`External id "${patch.externalId}" is already used.`);
        }
        next.externalId = patch.externalId;
      }
    }

    await before({ type: "link.update", link: next, previous, actor: opts.actor ?? null });

    if (newKey !== oldKey) {
      if (!(await claimPointer(newKey, { tenant, id }))) {
        throw new ConflictError(`Slug "${next.slug}" is already taken on ${next.domain}.`);
      }
    }
    await storage.setItem(keys.linkKey(tenant, id), next);
    if (newKey !== oldKey) await storage.removeItem(oldKey);
    if (previous.externalId !== next.externalId) {
      if (previous.externalId) {
        await storage.removeItem(keys.externalIdKey(tenant, previous.externalId));
      }
      if (next.externalId) await storage.setItem(keys.externalIdKey(tenant, next.externalId), id);
    }
    const at = next.updatedAt;
    await audit(tenant, "link.updated", `link:${id}`, opts.actor, {
      fields: Object.keys(patch).filter((k) => k !== "password"),
    });
    emit({
      type: "link",
      hostname: previous.domain,
      slugKey: slugKey(previous.slug, oldDomain.caseSensitive ?? false),
    });
    if (newKey !== oldKey) {
      emit({
        type: "link",
        hostname: next.domain,
        slugKey: slugKey(next.slug, newDomain.caseSensitive ?? false),
      });
    }
    await after({ type: "link.updated", link: next, previous, at, actor: opts.actor ?? null });
    return next;
  }

  async function removeLinkRecords(link: Link): Promise<void> {
    const domain = await storage.getItem<Domain>(keys.domainKey(link.domain));
    const key = keys.slugKey(link.domain, slugKey(link.slug, domain?.caseSensitive ?? false));
    const pointer = await storage.getItem<SlugPointer>(key);
    if (pointer?.id === link.id) await storage.removeItem(key);
    await storage.removeItem(keys.linkKey(link.tenant, link.id));
    await storage.removeItem(keys.counterKey(link.tenant, link.id));
    if (link.externalId) await storage.removeItem(keys.externalIdKey(link.tenant, link.externalId));
    emit({
      type: "link",
      hostname: link.domain,
      slugKey: slugKey(link.slug, domain?.caseSensitive ?? false),
    });
  }

  async function deleteLink(tenant: string, id: string, opts: ActorOptions = {}): Promise<Link> {
    guard("delete a link");
    const link = await requireLink(tenant, id);
    await before({ type: "link.delete", link, actor: opts.actor ?? null });
    await removeLinkRecords(link);
    await audit(tenant, "link.deleted", `link:${id}`, opts.actor, {
      slug: link.slug,
      domain: link.domain,
    });
    await after({ type: "link.deleted", link, at: nowIso(), actor: opts.actor ?? null });
    return link;
  }

  // ---------------------------------------------------------------- counters

  const pendingCounts = new Map<string, { tenant: string; id: string; n: number }>();
  let counterTimer: ReturnType<typeof setTimeout> | undefined;
  let counterFlush: Promise<void> = Promise.resolve();
  const counterFlushMs = options.counterFlushMs ?? 2000;

  async function addToCounter(tenant: string, id: string, n: number): Promise<void> {
    const key = keys.counterKey(tenant, id);
    if (isCompareAndSwap(storage)) {
      for (let i = 0; i < 10; i++) {
        const current = await storage.getItem<number>(key);
        if (
          await storage.compareAndSwap<number>({ key, expected: current, next: (current ?? 0) + n })
        ) {
          return;
        }
      }
    }
    await storage.setItem(key, ((await storage.getItem<number>(key)) ?? 0) + n);
  }

  function flushCounters(): Promise<void> {
    if (counterTimer) clearTimeout(counterTimer);
    counterTimer = undefined;
    counterFlush = counterFlush.then(async () => {
      const batch = [...pendingCounts.values()];
      pendingCounts.clear();
      for (const c of batch) {
        try {
          await addToCounter(c.tenant, c.id, c.n);
        } catch {
          // counters are approximate; a failed flush is dropped
        }
      }
    });
    return counterFlush;
  }

  async function getClickCount(tenant: string, id: string): Promise<number> {
    const pending = pendingCounts.get(`${tenant}\u0000${id}`)?.n ?? 0;
    return (await readCounter(tenant, id)) + pending;
  }

  // ---------------------------------------------------------------- conversions

  async function getCustomer(tenant: string, customerId: string): Promise<Customer | null> {
    return storage.getItem<Customer>(keys.customerKey(tenant, customerId));
  }

  async function bindCustomer(
    tenant: string,
    customerId: string,
    clickId: string | undefined,
    extra: { name?: string; email?: string; metadata?: JsonObject },
    at: string,
  ): Promise<{ customer: Customer; ref: ClickRef } | null> {
    const existing = await getCustomer(tenant, customerId);
    if (existing) {
      const ref = await storage.getItem<ClickRef>(keys.clickKey(existing.clickId));
      return {
        customer: existing,
        ref: ref ?? {
          clickId: existing.clickId,
          tenant,
          linkId: existing.linkId,
          domain: "",
          slug: "",
          at: existing.firstSeenAt,
        },
      };
    }
    if (!clickId) return null;
    const ref = await storage.getItem<ClickRef>(keys.clickKey(clickId));
    if (!ref || ref.tenant !== tenant) return null;
    const customer: Customer = {
      id: customerId,
      tenant,
      clickId,
      linkId: ref.linkId,
      firstSeenAt: at,
      ...(extra.name ? { name: extra.name } : {}),
      ...(extra.email ? { email: extra.email } : {}),
      ...(extra.metadata ? { metadata: extra.metadata } : {}),
    };
    await storage.setItem(keys.customerKey(tenant, customerId), customer);
    return { customer, ref };
  }

  async function linkDomainSlug(ref: ClickRef): Promise<{ domain: string; slug: string }> {
    if (ref.domain) return { domain: ref.domain, slug: ref.slug };
    const link = await getLink(ref.tenant, ref.linkId);
    return { domain: link?.domain ?? "", slug: link?.slug ?? "" };
  }

  async function trackLead(input: TrackLeadInput): Promise<ConversionResult<LeadEvent> | null> {
    const tenant = input.tenant ?? DEFAULT_TENANT;
    const issues = validateKeySegment(input.customerId, "customerId");
    if (issues.length) throw new ValidationError(issues);
    const at = input.at ?? nowIso();
    const bound = await bindCustomer(
      tenant,
      input.customerId,
      input.clickId,
      {
        ...(input.customerName ? { name: input.customerName } : {}),
        ...(input.customerEmail ? { email: input.customerEmail } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
      at,
    );
    if (!bound) return null;
    const { domain, slug } = await linkDomainSlug(bound.ref);
    const event: LeadEvent = {
      type: "lead",
      id: newId("lead", now()),
      at,
      tenant,
      linkId: bound.customer.linkId,
      domain,
      slug,
      clickId: bound.customer.clickId,
      customerId: input.customerId,
      name: input.name ?? "Sign up",
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    await analytics.ingest([event]);
    await after({
      type: "lead.created",
      event,
      customer: bound.customer,
      link: await getLink(tenant, bound.customer.linkId),
      at,
    });
    return { event, customer: bound.customer };
  }

  async function trackSale(input: TrackSaleInput): Promise<ConversionResult<SaleEvent> | null> {
    const tenant = input.tenant ?? DEFAULT_TENANT;
    const issues = validateKeySegment(input.customerId, "customerId");
    if (!Number.isFinite(input.amount) || input.amount < 0) {
      issues.push({ path: "amount", message: "must be a non-negative number (minor units)" });
    }
    if (input.invoiceId) issues.push(...validateKeySegment(input.invoiceId, "invoiceId"));
    if (input.currency && !/^[A-Za-z]{3}$/.test(input.currency)) {
      issues.push({ path: "currency", message: "must be an ISO 4217 code" });
    }
    if (issues.length) throw new ValidationError(issues);
    const at = input.at ?? nowIso();
    if (input.invoiceId) {
      const prior = await storage.getItem<SaleEvent>(keys.saleKey(tenant, input.invoiceId));
      if (prior) {
        const customer = await getCustomer(tenant, prior.customerId);
        if (customer) return { event: prior, customer, duplicate: true };
      }
    }
    const bound = await bindCustomer(tenant, input.customerId, input.clickId, {}, at);
    if (!bound) return null;
    const { domain, slug } = await linkDomainSlug(bound.ref);
    const event: SaleEvent = {
      type: "sale",
      id: newId("sale", now()),
      at,
      tenant,
      linkId: bound.customer.linkId,
      domain,
      slug,
      clickId: bound.customer.clickId,
      customerId: input.customerId,
      name: input.name ?? "Purchase",
      amount: Math.round(input.amount),
      currency: (input.currency ?? "USD").toUpperCase(),
      ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    if (input.invoiceId) await storage.setItem(keys.saleKey(tenant, input.invoiceId), event);
    await analytics.ingest([event]);
    await after({
      type: "sale.created",
      event,
      customer: bound.customer,
      link: await getLink(tenant, bound.customer.linkId),
      at,
    });
    return { event, customer: bound.customer };
  }

  // ---------------------------------------------------------------- core object

  const core: LinksCore = {
    storage,
    analytics,
    readonly,
    reservedSlugs,
    deferredTtlMs,
    now,

    listTenants,
    getTenant: (key) => storage.getItem<Tenant>(keys.tenantKey(key)),
    async upsertTenant(input, opts = {}) {
      guard("update a tenant");
      assertValid(validateTenantInput(input));
      const existing = await storage.getItem<Tenant>(keys.tenantKey(input.key));
      const at = nowIso();
      const tenant: Tenant = {
        ...existing,
        ...input,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at,
      };
      await before({ type: "tenant.upsert", tenant, actor: opts.actor ?? null });
      await storage.setItem(keys.tenantKey(input.key), tenant);
      await indexAdd(keys.tenantsKey(), input.key);
      await audit(
        input.key,
        existing ? "tenant.updated" : "tenant.created",
        `tenant:${input.key}`,
        opts.actor,
      );
      await after({ type: "tenant.upserted", tenant, at, actor: opts.actor ?? null });
      return tenant;
    },
    async deleteTenant(key, opts = {}) {
      guard("delete a tenant");
      if (!(await storage.getItem(keys.tenantKey(key)))) {
        throw new NotFoundError(`Tenant "${key}" does not exist.`);
      }
      await before({ type: "tenant.delete", tenant: key, actor: opts.actor ?? null });
      for (const k of await storage.getKeys(keys.linksPrefix(key))) {
        const link = await storage.getItem<Link>(k);
        if (link) await removeLinkRecords(link);
      }
      for (const k of await storage.getKeys(keys.tenantPrefix(key))) await storage.removeItem(k);
      for (const d of await listDomains()) {
        if (d.tenant === key) {
          await storage.removeItem(keys.domainKey(d.hostname));
          await indexRemove(keys.domainsKey(), d.hostname);
          emit({ type: "domain", hostname: d.hostname });
        }
      }
      await indexRemove(keys.tenantsKey(), key);
      await audit(null, "tenant.deleted", `tenant:${key}`, opts.actor);
      await after({ type: "tenant.deleted", tenant: key, at: nowIso(), actor: opts.actor ?? null });
    },

    listDomains,
    getDomain,
    async createDomain(input, opts = {}) {
      guard("create a domain");
      assertValid(validateDomainInput(input));
      const hostname = input.hostname.toLowerCase();
      if (await storage.getItem(keys.domainKey(hostname))) {
        throw new ConflictError(`Domain "${hostname}" is already registered.`);
      }
      const at = nowIso();
      const domain: Domain = { ...input, hostname, createdAt: at, updatedAt: at };
      if (!domain.tenant) delete domain.tenant;
      await before({ type: "domain.create", domain, actor: opts.actor ?? null });
      if (domain.isDefault) await clearOtherDefaults(domain);
      await storage.setItem(keys.domainKey(hostname), domain);
      await indexAdd(keys.domainsKey(), hostname);
      if (domain.tenant) await ensureTenant(domain.tenant);
      await audit(domain.tenant ?? null, "domain.created", `domain:${hostname}`, opts.actor);
      emit({ type: "domain", hostname });
      await after({ type: "domain.created", domain, at, actor: opts.actor ?? null });
      return domain;
    },
    async updateDomain(hostname, patch, opts = {}) {
      guard("update a domain");
      assertValid(validateDomainInput(patch, "domain", true));
      const host = hostname.toLowerCase();
      const previous = await storage.getItem<Domain>(keys.domainKey(host));
      if (!previous) throw new NotFoundError(`Domain "${host}" is not registered.`);
      if (patch.caseSensitive !== undefined && patch.caseSensitive !== previous.caseSensitive) {
        const slugs = await storage.getKeys(keys.domainSlugsPrefix(host));
        if (slugs.length > 0) {
          throw new ConflictError("caseSensitive cannot change while the domain has links.");
        }
      }
      const next: Domain = { ...previous, updatedAt: nowIso() };
      for (const [k, v] of Object.entries(patch)) {
        if (k === "hostname") continue;
        if (v === null || v === undefined) delete (next as unknown as Record<string, unknown>)[k];
        else (next as unknown as Record<string, unknown>)[k] = v;
      }
      await before({ type: "domain.update", domain: next, actor: opts.actor ?? null });
      if (next.isDefault && !previous.isDefault) await clearOtherDefaults(next);
      await storage.setItem(keys.domainKey(host), next);
      await audit(next.tenant ?? null, "domain.updated", `domain:${host}`, opts.actor);
      emit({ type: "domain", hostname: host });
      await after({
        type: "domain.updated",
        domain: next,
        at: next.updatedAt as string,
        actor: opts.actor ?? null,
      });
      return next;
    },
    async deleteDomain(hostname, opts = {}) {
      guard("delete a domain");
      const host = hostname.toLowerCase();
      const domain = await storage.getItem<Domain>(keys.domainKey(host));
      if (!domain) throw new NotFoundError(`Domain "${host}" is not registered.`);
      const pointers = await storage.getKeys(keys.domainSlugsPrefix(host));
      if (pointers.length > 0 && !opts.force) {
        throw new ConflictError(
          `Domain "${host}" still has ${pointers.length} link(s); delete them or pass force.`,
        );
      }
      await before({ type: "domain.delete", hostname: host, actor: opts.actor ?? null });
      for (const key of pointers) {
        const pointer = await storage.getItem<SlugPointer>(key);
        const link = pointer ? await getLink(pointer.tenant, pointer.id) : null;
        if (link) await removeLinkRecords(link);
        else await storage.removeItem(key);
      }
      await storage.removeItem(keys.domainKey(host));
      await indexRemove(keys.domainsKey(), host);
      await audit(domain.tenant ?? null, "domain.deleted", `domain:${host}`, opts.actor);
      emit({ type: "domain", hostname: host });
      await after({ type: "domain.deleted", domain, at: nowIso(), actor: opts.actor ?? null });
    },

    createLink,
    getLink,
    async getLinkByExternalId(tenant, externalId) {
      const id = await storage.getItem<string>(keys.externalIdKey(tenant, externalId));
      return id ? getLink(tenant, id) : null;
    },
    getLinkBySlug,
    listLinks,
    updateLink,
    deleteLink,
    async listTags(tenant) {
      const counts = new Map<string, number>();
      for (const k of await storage.getKeys(keys.linksPrefix(tenant))) {
        const link = await storage.getItem<Link>(k);
        for (const t of link?.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      return [...counts]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    },
    async importLinks(tenant, rows, opts = {}) {
      if (!opts.dryRun) guard("import links");
      const policy = opts.onConflict ?? "skip";
      const out: ImportResult = { created: 0, updated: 0, skipped: 0, errors: 0, rows: [] };
      for (const [index, row] of rows.entries()) {
        const input = { ...row, tenant };
        try {
          if (opts.dryRun) {
            assertValid(validateLinkInput(input, { mode: "create", reservedSlugs, ...urlOptions }));
            const existing = await findExisting(tenant, input);
            if (existing && policy === "error") throw new ConflictError("already exists");
            const status = existing ? (policy === "update" ? "updated" : "skipped") : "created";
            out[status]++;
            out.rows.push({ index, status });
            continue;
          }
          const existing = await findExisting(tenant, input);
          if (existing) {
            if (policy === "skip") {
              out.skipped++;
              out.rows.push({ index, status: "skipped", link: existing });
              continue;
            }
            if (policy === "error") throw new ConflictError("already exists");
            const { tenant: _t, ...patch } = input;
            const link = await updateLink(tenant, existing.id, patch, opts);
            out.updated++;
            out.rows.push({ index, status: "updated", link });
            continue;
          }
          const link = await createLink(input, opts);
          out.created++;
          out.rows.push({ index, status: "created", link });
        } catch (error) {
          out.errors++;
          out.rows.push({
            index,
            status: "error",
            error:
              error instanceof ValidationError
                ? error.errors.map((e) => `${e.path}: ${e.message}`).join("; ")
                : error instanceof Error
                  ? error.message
                  : String(error),
          });
        }
      }
      if (!opts.dryRun && (out.created || out.updated)) {
        await audit(tenant, "links.imported", `tenant:${tenant}`, opts.actor, {
          created: out.created,
          updated: out.updated,
          skipped: out.skipped,
          errors: out.errors,
        });
      }
      return out;
    },

    countClick(tenant, id) {
      const key = `${tenant}\u0000${id}`;
      const entry = pendingCounts.get(key);
      if (entry) entry.n++;
      else pendingCounts.set(key, { tenant, id, n: 1 });
      if (!counterTimer && counterFlushMs > 0) {
        counterTimer = setTimeout(() => void flushCounters(), counterFlushMs);
        (counterTimer as { unref?: () => void }).unref?.();
      }
    },
    getClickCount,
    flushCounters,

    async recordClickRef(ref) {
      await storage.setItem(keys.clickKey(ref.clickId), ref);
    },
    getClickRef: (clickId) => storage.getItem<ClickRef>(keys.clickKey(clickId)),
    trackLead,
    trackSale,
    getCustomer,
    async listCustomers(tenant) {
      const all = await Promise.all(
        (await storage.getKeys(keys.customersPrefix(tenant))).map((k) =>
          storage.getItem<Customer>(k),
        ),
      );
      return all
        .filter(nonEmpty)
        .sort((a, b) =>
          a.firstSeenAt < b.firstSeenAt ? 1 : a.firstSeenAt > b.firstSeenAt ? -1 : 0,
        );
    },

    async saveDeferred(handoff, fingerprint) {
      await storage.setItem(keys.deferredKey(handoff.clickId), handoff);
      if (fingerprint) {
        await storage.setItem(keys.deferredFingerprintKey(fingerprint, handoff.clickId), 1);
      }
    },
    async claimDeferred(input) {
      const at = now();
      const claim = async (clickId: string): Promise<DeferredHandoff | null> => {
        const key = keys.deferredKey(clickId);
        const handoff = await storage.getItem<DeferredHandoff>(key);
        if (!handoff || handoff.claimedAt || Date.parse(handoff.expiresAt) <= at) return null;
        const next = { ...handoff, claimedAt: new Date(at).toISOString() };
        if (isCompareAndSwap(storage)) {
          if (!(await storage.compareAndSwap({ key, expected: handoff, next }))) return null;
        } else {
          await storage.setItem(key, next);
        }
        return next;
      };
      if (input.clickId) {
        const handoff = await claim(input.clickId);
        return handoff ? { handoff, matchType: "exact" } : null;
      }
      if (input.fingerprint) {
        const candidates = (
          await storage.getKeys(keys.deferredFingerprintPrefix(input.fingerprint))
        )
          .map(keys.lastSegment)
          .sort()
          .reverse(); // click ids are time-sortable: newest first
        for (const clickId of candidates) {
          const handoff = await claim(clickId);
          if (handoff) return { handoff, matchType: "probabilistic" };
        }
      }
      return null;
    },

    async listAudit(tenant) {
      const log =
        (await storage.getItem<AuditEntry[]>(
          tenant ? keys.auditLogKey(tenant) : keys.globalAuditLogKey(),
        )) ?? [];
      return log.reverse();
    },
    queryAnalytics: (query) => analytics.query(query),

    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async prune() {
      const at = now();
      let clickRefs = 0;
      let deferred = 0;
      for (const key of await storage.getKeys(keys.clicksPrefix())) {
        const ref = await storage.getItem<ClickRef>(key);
        if (!ref || Date.parse(ref.at) + attributionWindowMs <= at) {
          await storage.removeItem(key);
          clickRefs++;
        }
      }
      for (const key of await storage.getKeys(keys.deferredPrefix())) {
        const handoff = await storage.getItem<DeferredHandoff>(key);
        if (!handoff || Date.parse(handoff.expiresAt) <= at || handoff.claimedAt) {
          await storage.removeItem(key);
          deferred++;
        }
      }
      for (const key of await storage.getKeys(`${keys.ROOT}/deferred/f/`)) {
        const clickId = keys.lastSegment(key);
        if (!(await storage.getItem(keys.deferredKey(clickId)))) await storage.removeItem(key);
      }
      return { clickRefs, deferred };
    },
    async close() {
      await flushCounters();
    },
  };

  async function clearOtherDefaults(domain: Domain): Promise<void> {
    for (const other of await listDomains()) {
      if (other.hostname !== domain.hostname && other.isDefault && other.tenant === domain.tenant) {
        await storage.setItem(keys.domainKey(other.hostname), { ...other, isDefault: false });
      }
    }
  }

  async function findExisting(tenant: string, input: CreateLinkInput): Promise<Link | null> {
    if (input.externalId) {
      const byExt = await core.getLinkByExternalId(tenant, input.externalId);
      if (byExt) return byExt;
    }
    if (input.slug) {
      const domain = input.domain
        ? input.domain.toLowerCase()
        : (await pickDomain(tenant, undefined)).hostname;
      const bySlug = await getLinkBySlug(domain, input.slug);
      if (bySlug) {
        if (bySlug.tenant !== tenant) throw new ConflictError("slug is taken by another tenant");
        return bySlug;
      }
    }
    return null;
  }

  return core;
}
