/**
 * Storage key layout for `@xtandard/links` (ADR 0005). Pure string helpers —
 * no dependencies.
 *
 * ```txt
 * lnk/tenants                          -> string[] index
 * lnk/t/{tenant}/meta                  -> Tenant
 * lnk/domains                          -> string[] index (hostnames)
 * lnk/domains/{hostname}               -> Domain
 * lnk/s/{hostname}/{slugKey}           -> SlugPointer { tenant, id }  (redirect lookup)
 * lnk/t/{tenant}/links/{id}            -> Link
 * lnk/t/{tenant}/ext/{externalId}      -> link id
 * lnk/t/{tenant}/customers/{id}        -> Customer
 * lnk/t/{tenant}/sales/{invoiceId}     -> sale event id (idempotency)
 * lnk/t/{tenant}/counters/{id}        -> number (approximate click counter)
 * lnk/t/{tenant}/audit-log             -> AuditEntry[]
 * lnk/clicks/{clickId}                 -> ClickRef (attribution window)
 * lnk/deferred/c/{clickId}             -> DeferredHandoff
 * lnk/deferred/f/{fingerprint}/{clickId} -> 1 (fingerprint index)
 * lnk/rollup/...                       -> analytics rollups (analytics/kv only)
 * ```
 *
 * Every variable segment is `encodeURIComponent`-encoded, so slugs containing
 * `/` (nested slugs) and ids with odd characters cannot escape their prefix.
 *
 * @module
 */

/** Root namespace segment for all keys. */
export const ROOT = "lnk";

const enc = encodeURIComponent;

/** Index of tenant keys. */
export const tenantsKey = () => `${ROOT}/tenants`;
/** Tenant metadata. */
export const tenantKey = (tenant: string) => `${ROOT}/t/${enc(tenant)}/meta`;
/** Prefix of everything a tenant owns. */
export const tenantPrefix = (tenant: string) => `${ROOT}/t/${enc(tenant)}/`;

/** Index of domain hostnames. */
export const domainsKey = () => `${ROOT}/domains`;
/** A domain record. */
export const domainKey = (hostname: string) => `${ROOT}/domains/${enc(hostname)}`;

/** Prefix of every slug pointer (watched by the resolver). */
export const slugsPrefix = () => `${ROOT}/s/`;
/** Prefix of a domain's slug pointers. */
export const domainSlugsPrefix = (hostname: string) => `${ROOT}/s/${enc(hostname)}/`;
/** The pointer for a normalized slug key on a domain. */
export const slugKey = (hostname: string, slugKey: string) =>
  `${ROOT}/s/${enc(hostname)}/${enc(slugKey)}`;

/** Prefix of a tenant's links. */
export const linksPrefix = (tenant: string) => `${ROOT}/t/${enc(tenant)}/links/`;
/** A link record. */
export const linkKey = (tenant: string, id: string) => `${ROOT}/t/${enc(tenant)}/links/${enc(id)}`;
/** External-id → link-id index. */
export const externalIdKey = (tenant: string, externalId: string) =>
  `${ROOT}/t/${enc(tenant)}/ext/${enc(externalId)}`;

/** A customer bound to a click. */
export const customerKey = (tenant: string, customerId: string) =>
  `${ROOT}/t/${enc(tenant)}/customers/${enc(customerId)}`;
/** Prefix of a tenant's customers. */
export const customersPrefix = (tenant: string) => `${ROOT}/t/${enc(tenant)}/customers/`;
/** Sale idempotency marker. */
export const saleKey = (tenant: string, invoiceId: string) =>
  `${ROOT}/t/${enc(tenant)}/sales/${enc(invoiceId)}`;

/** The tenant's operator audit log. */
export const auditLogKey = (tenant: string) => `${ROOT}/t/${enc(tenant)}/audit-log`;
/** Audit log for global (non-tenant) actions, e.g. shared domains. */
export const globalAuditLogKey = () => `${ROOT}/audit-log`;

/** Prefix of every click ref. */
export const clicksPrefix = () => `${ROOT}/clicks/`;
/** A click ref (attribution). */
export const clickKey = (clickId: string) => `${ROOT}/clicks/${enc(clickId)}`;

/** A deferred handoff by click id. */
export const deferredKey = (clickId: string) => `${ROOT}/deferred/c/${enc(clickId)}`;
/** Prefix of every deferred handoff. */
export const deferredPrefix = () => `${ROOT}/deferred/c/`;
/** Prefix of the fingerprint index for one fingerprint. */
export const deferredFingerprintPrefix = (fingerprint: string) =>
  `${ROOT}/deferred/f/${enc(fingerprint)}/`;
/** Fingerprint index entry. */
export const deferredFingerprintKey = (fingerprint: string, clickId: string) =>
  `${ROOT}/deferred/f/${enc(fingerprint)}/${enc(clickId)}`;

/** Last path segment of a key, decoded. */
export const lastSegment = (key: string): string =>
  decodeURIComponent(key.slice(key.lastIndexOf("/") + 1));

/** Approximate non-bot click counter for a link (kept apart from the link record). */
export const counterKey = (tenant: string, id: string) =>
  `${ROOT}/t/${enc(tenant)}/counters/${enc(id)}`;
