/**
 * The redirect plane (ADR 0002, 0004): a web-standard handler that turns
 * `GET https://go.acme.com/{slug}` into a redirect, records the click without
 * waiting on the analytics sink, and serves deep-link association files,
 * password and link-preview pages.
 *
 * `handle(request, ctx?)` returns `null` when the request is not for a short
 * link (unknown host, reserved path, outside `basePath`, or an unknown slug on a
 * domain without `notFoundUrl`) so hosts can fall through to their own router;
 * `fetch` always answers (the 404 page instead of `null`).
 * Neither ever throws.
 *
 * Edge-safe: no optional dependencies; pass `ctx.waitUntil` on Workers /
 * Vercel so background writes outlive the response.
 *
 * Import from `@xtandard/links/redirect` (also re-exported by the root).
 *
 * @module redirect
 */

import type { AnalyticsSink } from "./analytics/contract.ts";
import { isPreviewBot } from "./clicks/bots.ts";
import { clientIp, edgeHeadersGeo, type GeoResolver } from "./clicks/geo.ts";
import {
  createClickIngestor,
  type ClickIngestor,
  type ClickIngestorOptions,
  type WaitUntil,
} from "./clicks/ingestor.ts";
import {
  dailySalt,
  optedOut,
  protectIp,
  visitorHash,
  type PrivacyOptions,
} from "./clicks/privacy.ts";
import {
  parseUserAgent as defaultParseUserAgent,
  type UserAgentParser,
} from "./clicks/useragent.ts";
import { createLinksCore, type LinksCore, type LinksCoreOptions } from "./core.ts";
import {
  deferredFingerprint,
  isPlayStoreUrl,
  wellKnownResponse,
  withInstallReferrer,
} from "./deeplinks.ts";
import { buildDestination, mergeUtm, referrerHost, utmFromQuery } from "./destination.ts";
import { newId } from "./id.ts";
import { sha256Hex, verifyPassword } from "./password.ts";
import { createResolver, type Resolver, type ResolverOptions } from "./resolver.ts";
import { evaluateRules, parseAcceptLanguage, type VisitorContext } from "./rules.ts";
import type { ClickEvent, Domain, GeoInfo, Link } from "./schema.ts";

/** Per-request runtime context (edge runtimes). */
export interface RedirectContext {
  /** Keep background work (click flush, attribution writes) alive after responding. */
  waitUntil?: WaitUntil;
}

/** Pages the handler renders itself. */
export type RedirectPage =
  | { kind: "not-found"; host: string; slug: string }
  | { kind: "expired"; link: Link }
  | { kind: "password"; link: Link; error?: boolean }
  | { kind: "preview"; link: Link; destination: string };

/** Options for {@link createRedirectHandler}. */
export interface RedirectHandlerOptions {
  /** A prebuilt core (share it with the admin panel). */
  core?: LinksCore;
  /** Storage, when no `core` is given. */
  storage?: LinksCoreOptions["storage"];
  /** Analytics sink, when no `core` is given (default: KV rollups). */
  analytics?: AnalyticsSink;
  /** Shared default domain, when no `core` is given. */
  defaultDomain?: string;
  /**
   * Serve path-prefixed links (`acme.com/l/{slug}`) on any host. Links are looked
   * up on the request host when it is a registered domain, else on `defaultDomain`.
   */
  basePath?: string;
  /** Resolver options, or a prebuilt resolver. */
  resolver?: ResolverOptions | Resolver;
  /** Ingestor options, a prebuilt ingestor, or `false` to record nothing. */
  ingestor?: Omit<ClickIngestorOptions, "sink"> | ClickIngestor | false;
  /** Geo resolver. Default: edge headers (Cloudflare, Vercel, CloudFront, Fastly). */
  geo?: GeoResolver;
  /** User-agent parser. Default: the built-in parser. */
  parseUserAgent?: UserAgentParser;
  /** Client IP. Default: `CF-Connecting-IP` / `X-Real-IP` / first `X-Forwarded-For`. */
  getIp?: (request: Request) => string | undefined;
  /** Request host. Default: `X-Forwarded-Host`, then the URL host. */
  getHost?: (request: Request) => string;
  privacy?: PrivacyOptions;
  /** `"flag"` (default) records bot clicks with `bot: true`; `"drop"` records nothing. */
  bots?: "flag" | "drop";
  /** Conversion tracking: `enabled` turns it on for every link; `param` names the click-id parameter. */
  conversions?: { enabled?: boolean; param?: string };
  /** `Cache-Control` on redirects. Default `"private, no-store"` (every click counted). */
  cacheControl?: string;
  /** Fire-and-forget tap for every recorded click. */
  onClick?: (event: ClickEvent, link: Link) => void;
  /** Errors from enrichment, storage or taps. Default `console.warn`. */
  onError?: (error: unknown) => void;
  /** Render built-in pages yourself. Return `null` to use the default page. */
  renderPage?: (page: RedirectPage, request: Request) => Response | null | Promise<Response | null>;
}

/** The redirect handler. */
export interface RedirectHandler {
  /** Answer a short-link request, or `null` when it is not one. Never throws. */
  handle(request: Request, ctx?: RedirectContext): Promise<Response | null>;
  /** Like `handle`, but answers 404 instead of `null`. */
  fetch(request: Request, ctx?: RedirectContext): Promise<Response>;
  core: LinksCore;
  resolver: Resolver;
  /** `null` when recording is disabled. */
  ingestor: ClickIngestor | null;
  /** Flush pending clicks and counters, stop timers. */
  close(): Promise<void>;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title: string, body: string, status: number, extraHead = ""): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>${extraHead}<style>:root{color-scheme:light dark;--bg:#fafafa;--fg:#18181b;--muted:#71717a;--card:#fff;--line:#e4e4e7;--accent:#0d9488}@media (prefers-color-scheme:dark){:root{--bg:#09090b;--fg:#fafafa;--muted:#a1a1aa;--card:#18181b;--line:#27272a;--accent:#2dd4bf}}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:16px}.card{width:100%;max-width:380px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px}h1{font-size:18px;margin:0 0 6px}p{color:var(--muted);margin:0 0 16px}input{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit;font:inherit;margin-bottom:10px}button{width:100%;padding:10px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}.err{color:#dc2626}</style></head><body><main class="card">${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
    },
  });
}

function defaultPage(p: RedirectPage): Response {
  switch (p.kind) {
    case "not-found":
      return page(
        "Link not found",
        `<h1>Link not found</h1><p>This short link does not exist.</p>`,
        404,
      );
    case "expired":
      return page(
        "Link expired",
        `<h1>Link expired</h1><p>This link is no longer available.</p>`,
        410,
      );
    case "password":
      return page(
        "Password required",
        `<h1>Password required</h1><p>This link is password protected.</p>${p.error ? `<p class="err">Incorrect password.</p>` : ""}<form method="post"><input type="password" name="password" placeholder="Password" autofocus required aria-label="Password"><button type="submit">Continue</button></form>`,
        p.error ? 401 : 200,
      );
    case "preview": {
      const pv = p.link.preview ?? {};
      const title = pv.title ?? p.link.title ?? p.destination;
      const meta = [
        `<meta property="og:title" content="${escapeHtml(title)}">`,
        pv.description
          ? `<meta property="og:description" content="${escapeHtml(pv.description)}">`
          : "",
        pv.image ? `<meta property="og:image" content="${escapeHtml(pv.image)}">` : "",
        `<meta property="og:url" content="${escapeHtml(p.destination)}">`,
        `<meta name="twitter:card" content="${pv.image ? "summary_large_image" : "summary"}">`,
        `<meta name="twitter:title" content="${escapeHtml(title)}">`,
        pv.description
          ? `<meta name="twitter:description" content="${escapeHtml(pv.description)}">`
          : "",
        pv.image ? `<meta name="twitter:image" content="${escapeHtml(pv.image)}">` : "",
        `<meta http-equiv="refresh" content="0;url=${escapeHtml(p.destination)}">`,
      ].join("");
      return page(
        title,
        `<h1>${escapeHtml(title)}</h1><p><a href="${escapeHtml(p.destination)}">Continue</a></p>`,
        200,
        meta,
      );
    }
  }
}

const PASSWORD_COOKIE = "xl_pw_";

/** Path (on a short domain, under `basePath`) of the deferred deep-link claim endpoint. */
export const DEFERRED_CLAIM_PATH = "/_links/deferred/claim";

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

/** The unlock-cookie value for a password-protected link (derived from its stored hash). */
async function unlockToken(link: Link): Promise<string> {
  return (await sha256Hex(`${link.id}|${link.password?.hash ?? ""}`)).slice(0, 32);
}

function isExpiredByDate(link: Link, now: number): boolean {
  return link.expiresAt !== undefined && Date.parse(link.expiresAt) <= now;
}

/**
 * Create the redirect handler.
 *
 * @example
 * ```ts
 * import { createRedirectHandler } from "@xtandard/links";
 *
 * const redirects = createRedirectHandler({ core });
 * Bun.serve({ fetch: (req) => redirects.fetch(req) });
 * ```
 */
export function createRedirectHandler(options: RedirectHandlerOptions): RedirectHandler {
  const core =
    options.core ??
    createLinksCore({
      storage:
        options.storage ??
        (() => {
          throw new Error("createRedirectHandler needs `core` or `storage`.");
        })(),
      ...(options.analytics ? { analytics: options.analytics } : {}),
      ...(options.defaultDomain ? { defaultDomain: options.defaultDomain } : {}),
    });
  const onError =
    options.onError ?? ((e: unknown) => console.warn("[@xtandard/links] redirect:", e));
  const resolver =
    options.resolver && "resolve" in options.resolver
      ? options.resolver
      : createResolver(core, { onError, ...(options.resolver as ResolverOptions | undefined) });
  const ingestor: ClickIngestor | null =
    options.ingestor === false
      ? null
      : options.ingestor && "capture" in options.ingestor
        ? options.ingestor
        : createClickIngestor({ sink: core.analytics, ...options.ingestor });
  const geo = options.geo ?? edgeHeadersGeo();
  const parseUa = options.parseUserAgent ?? defaultParseUserAgent;
  const getIp = options.getIp ?? clientIp;
  const getHost =
    options.getHost ??
    ((request: Request) =>
      (request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? new URL(request.url).host)
        .replace(/:\d+$/, "")
        .toLowerCase());
  const privacy = options.privacy ?? {};
  const botPolicy = options.bots ?? "flag";
  const clickIdParam = options.conversions?.param ?? "xl_id";
  const conversionsEverywhere = options.conversions?.enabled ?? false;
  const cacheControl = options.cacheControl ?? "private, no-store";
  const basePath = options.basePath ? `/${options.basePath.replace(/^\/+|\/+$/g, "")}` : "";
  const defaultDomain = options.defaultDomain?.toLowerCase();

  const render = async (p: RedirectPage, request: Request): Promise<Response> => {
    if (options.renderPage) {
      try {
        const custom = await options.renderPage(p, request);
        if (custom) return custom;
      } catch (error) {
        onError(error);
      }
    }
    return defaultPage(p);
  };

  const redirect = (location: string, status = 302, link?: Link): Response =>
    new Response(null, {
      status,
      headers: {
        location,
        "cache-control": cacheControl,
        ...(link?.indexable ? {} : { "x-robots-tag": "noindex" }),
        "referrer-policy": "no-referrer-when-downgrade",
      },
    });

  const background = (ctx: RedirectContext | undefined, work: Promise<unknown>) => {
    const guarded = work.catch(onError);
    ctx?.waitUntil?.(guarded);
  };

  async function safeGeo(request: Request, ip: string | undefined): Promise<GeoInfo> {
    try {
      return (await geo(request, ip)) ?? {};
    } catch (error) {
      onError(error);
      return {};
    }
  }

  /**
   * `POST /_links/deferred/claim` — the app's first-open call (ADR 0008). Body
   * `{ clickId? }`: exact match by click id (install referrer / pasteboard),
   * otherwise a probabilistic match on the request's fingerprint.
   */
  async function claimDeferred(request: Request): Promise<Response> {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    let clickId: string | undefined;
    try {
      const text = await request.text();
      const body = text ? (JSON.parse(text) as { clickId?: unknown }) : {};
      if (typeof body.clickId === "string" && body.clickId) clickId = body.clickId;
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }
    const ua = parseUa(request.headers.get("user-agent") ?? "");
    const fingerprint = clickId
      ? undefined
      : await deferredFingerprint({
          ip: getIp(request),
          os: ua.os,
          salt: dailySalt(privacy.salt, core.now()),
        });
    const claimed = await core.claimDeferred({
      ...(clickId ? { clickId } : {}),
      ...(fingerprint ? { fingerprint } : {}),
    });
    if (!claimed) return json({ matched: false }, 404);
    const { handoff, matchType } = claimed;
    return json({
      matched: true,
      matchType,
      clickId: handoff.clickId,
      linkId: handoff.linkId,
      path: handoff.path,
      url: handoff.url,
    });
  }

  async function handle(request: Request, ctx?: RedirectContext): Promise<Response | null> {
    let resolvedLink: Link | null = null;
    try {
      const method = request.method.toUpperCase();
      if (method !== "GET" && method !== "HEAD" && method !== "POST") return null;
      const url = new URL(request.url);
      let pathname = url.pathname;
      if (basePath) {
        if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return null;
        pathname = pathname.slice(basePath.length) || "/";
      }
      const host = getHost(request);
      const domain: Domain | null = await resolver.domain(host);

      if (pathname.startsWith("/.well-known/")) {
        if (method === "POST" || !domain) return null;
        return wellKnownResponse(domain, pathname);
      }

      const lookupHost = domain?.hostname ?? (basePath ? defaultDomain : undefined);
      if (!lookupHost) return null; // not one of our hosts

      if (pathname === DEFERRED_CLAIM_PATH) {
        return method === "POST" ? claimDeferred(request) : null;
      }
      const lookupDomain = domain ?? (lookupHost ? await resolver.domain(lookupHost) : null);

      let slug: string;
      try {
        slug = decodeURIComponent(pathname).replace(/^\/+|\/+$/g, "");
      } catch {
        return render({ kind: "not-found", host: lookupHost, slug: pathname }, request);
      }
      if (slug === "") {
        if (method === "POST") return null;
        return lookupDomain?.rootUrl ? redirect(lookupDomain.rootUrl) : null;
      }
      const first = (slug.split("/")[0] ?? "").toLowerCase();
      if (core.reservedSlugs.some((r) => r.toLowerCase() === first)) return null;

      const { link } = await resolver.resolve(lookupHost, slug);
      if (!link || link.disabled) {
        if (method === "POST") return null;
        if (lookupDomain?.notFoundUrl) return redirect(lookupDomain.notFoundUrl);
        // Not a link: fall through so a host sharing this domain keeps its own routes.
        // `fetch()` renders the 404 page instead.
        return null;
      }
      resolvedLink = link;
      const now = core.now();

      // Expiry: by date (exact) or by click budget (approximate counter).
      let expired = isExpiredByDate(link, now);
      if (!expired && link.maxClicks !== undefined) {
        expired = (await core.getClickCount(link.tenant, link.id)) >= link.maxClicks;
      }
      if (expired) {
        if (method === "POST") return null;
        return link.expiredUrl
          ? redirect(link.expiredUrl, 302, link)
          : render({ kind: "expired", link }, request);
      }

      // Password gate.
      if (link.password) {
        const token = await unlockToken(link);
        const cookieName = `${PASSWORD_COOKIE}${link.id}`;
        if (method === "POST") {
          const form = await request.formData().catch(() => null);
          const candidate = form?.get("password");
          if (typeof candidate === "string" && (await verifyPassword(candidate, link.password))) {
            return new Response(null, {
              status: 303,
              headers: {
                location: url.pathname + url.search,
                "set-cookie": `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600${url.protocol === "https:" ? "; Secure" : ""}`,
                "cache-control": "private, no-store",
              },
            });
          }
          return render({ kind: "password", link, error: true }, request);
        }
        if (readCookie(request, cookieName) !== token) {
          return render({ kind: "password", link }, request);
        }
      } else if (method === "POST") {
        return null;
      }

      // Visitor context.
      const userAgent = request.headers.get("user-agent") ?? "";
      const ua = parseUa(userAgent);
      const ip = getIp(request);
      const geoInfo = await safeGeo(request, ip);
      const query = url.searchParams;
      const referrer = request.headers.get("referer") ?? query.get("ref") ?? undefined;
      const visitorCtx: VisitorContext = {
        device: ua.device,
        os: ua.os,
        browser: ua.browser,
        ...(geoInfo.country ? { country: geoInfo.country } : {}),
        ...(geoInfo.continent ? { continent: geoInfo.continent } : {}),
        languages: parseAcceptLanguage(request.headers.get("accept-language")),
        referrerHost: referrerHost(referrer),
        qr: query.get("qr") === "1",
        query,
        now,
      };
      const visitor = await visitorHash({ ip, userAgent, tenant: link.tenant }, privacy, now);
      const clickId = newId("clk", now);

      // Destination: platform stores first, then rules, then the default.
      let target = link.url;
      let ruleId: string | undefined;
      let variant: string | undefined;
      if (ua.os === "ios" && link.ios) target = link.ios;
      else if (ua.os === "android" && link.android) target = link.android;
      else {
        let match = null;
        try {
          match = evaluateRules(link.rules, visitorCtx, `${visitor ?? clickId}:${link.id}`);
        } catch (error) {
          onError(error);
        }
        if (match) {
          target = match.url;
          ruleId = match.ruleId;
          variant = match.variant;
        }
      }
      const trackConversions = link.trackConversions ?? conversionsEverywhere;
      let destination = buildDestination({
        url: target,
        ...(link.utm ? { utm: link.utm } : {}),
        ...(link.passQuery === false ? {} : { passQuery: query }),
        ...(trackConversions ? { clickId, clickIdParam } : {}),
      });
      if (isPlayStoreUrl(destination)) {
        destination = withInstallReferrer(destination, clickId, clickIdParam);
      }

      const preview = isPreviewBot(userAgent);
      const sink = ingestor;
      const record = method === "GET" && !(privacy.respectDoNotTrack && optedOut(request));
      if (sink && record && !(ua.bot && botPolicy === "drop")) {
        background(
          ctx,
          (async () => {
            const protectedIp = await protectIp(ip, privacy, now);
            const utm = mergeUtm(utmFromQuery(query), link.utm);
            const event: ClickEvent = {
              type: "click",
              id: clickId,
              at: new Date(now).toISOString(),
              tenant: link.tenant,
              linkId: link.id,
              domain: link.domain,
              slug: link.slug,
              destination,
              device: ua.device,
              os: ua.os,
              browser: ua.browser,
              referrerHost: visitorCtx.referrerHost,
              bot: ua.bot,
              qr: visitorCtx.qr,
              ...(ruleId ? { ruleId } : {}),
              ...(variant ? { variant } : {}),
              ...(geoInfo.country ? { country: geoInfo.country } : {}),
              ...(geoInfo.continent ? { continent: geoInfo.continent } : {}),
              ...(geoInfo.region ? { region: geoInfo.region } : {}),
              ...(geoInfo.city ? { city: geoInfo.city } : {}),
              ...(visitorCtx.languages[0] ? { language: visitorCtx.languages[0] } : {}),
              ...(referrer ? { referrer } : {}),
              ...(protectedIp ? { ip: protectedIp } : {}),
              ...(visitor ? { visitor } : {}),
              ...(privacy.userAgent ? { userAgent } : {}),
              ...(utm ? { utm } : {}),
            };
            sink.capture(event, ctx?.waitUntil ? { waitUntil: ctx.waitUntil } : undefined);
            if (!ua.bot) core.countClick(link.tenant, link.id);
            if (options.onClick) {
              try {
                options.onClick(event, link);
              } catch (error) {
                onError(error);
              }
            }
            const writes: Promise<unknown>[] = [];
            if (!ua.bot && trackConversions) {
              writes.push(
                core.recordClickRef({
                  clickId,
                  tenant: link.tenant,
                  linkId: link.id,
                  domain: link.domain,
                  slug: link.slug,
                  at: event.at,
                }),
              );
            }
            if (!ua.bot && link.deepLink?.deferred && (ua.os === "ios" || ua.os === "android")) {
              const fingerprint = await deferredFingerprint({
                ip,
                os: ua.os,
                salt: dailySalt(privacy.salt, now),
              });
              writes.push(
                core.saveDeferred(
                  {
                    clickId,
                    tenant: link.tenant,
                    linkId: link.id,
                    path: link.deepLink.path ?? "/",
                    url: destination,
                    os: ua.os,
                    at: event.at,
                    expiresAt: new Date(now + core.deferredTtlMs).toISOString(),
                  },
                  fingerprint,
                ),
              );
            }
            await Promise.all(writes);
          })(),
        );
      }

      if (preview && link.preview) {
        return render({ kind: "preview", link, destination }, request);
      }
      return redirect(destination, link.redirectStatus ?? 302, link);
    } catch (error) {
      onError(error);
      // Degrade: a resolved link still redirects to its default destination.
      if (resolvedLink && !resolvedLink.password)
        return redirect(resolvedLink.url, 302, resolvedLink);
      return null;
    }
  }

  return {
    handle,
    async fetch(request, ctx) {
      const response = await handle(request, ctx);
      if (response) return response;
      let host = "";
      try {
        host = getHost(request);
      } catch {
        // ignore
      }
      return render(
        { kind: "not-found", host, slug: new URL(request.url).pathname.slice(1) },
        request,
      );
    },
    core,
    resolver,
    ingestor,
    async close() {
      resolver.close();
      await ingestor?.flush();
      await core.flushCounters();
    },
  };
}
