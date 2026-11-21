/**
 * `xtandard-links` CLI. Operates on the same storage your app/panel uses
 * (configured via `STORAGE_DRIVER` and friends, mirroring the standalone app),
 * so it slots into shell, CI and migration workflows.
 *
 * Commands: `serve` (panel + redirects on one port, no Docker), `links
 * create|list|get|delete`, `domains add|list|remove`, `import` (CSV from
 * Bitly, Dub, Shlink, Kutt or our own export), `export` (CSV), `stats`, `qr`
 * and `prune`.
 *
 * @module
 */

import type { AuthProvider } from "./auth/contract.ts";
import type { AuthorizationProvider } from "./authorization/contract.ts";
import { createLinksCore, publicLink, type ImportConflictPolicy, type LinksCore } from "./core.ts";
import { DEFAULT_TENANT, type Link } from "./schema.ts";
import type { LinksStorage } from "./storage/contract.ts";
import { VERSION } from "./version.ts";

type Driver = "memory" | "file" | "redis" | "postgres" | "mongodb" | "sqlite" | "libsql";

const env = (key: string, fallback = ""): string => process.env[key] ?? fallback;

const isTruthy = (value: string): boolean => value === "1" || value.toLowerCase() === "true";

const out = (text: string) => void process.stdout.write(text);
const err = (text: string) => void process.stderr.write(text);

/**
 * `memory` storage is per-process; keep one instance so consecutive `run()`
 * calls in the same process (tests, scripts) share it.
 */
let memoryStorage: LinksStorage | undefined;

/** Build the links storage from env. */
async function buildStorage(): Promise<LinksStorage> {
  const driver = (env("STORAGE_DRIVER", "file") as Driver) || "file";
  switch (driver) {
    case "redis": {
      const { createRedisStorage } = await import("./storage/redis.ts");
      return createRedisStorage({
        url: env("REDIS_URL", "redis://localhost:6379"),
        prefix: env("STORAGE_PREFIX", "xtandard:links"),
      });
    }
    case "postgres": {
      const { createPostgresStorage } = await import("./storage/postgres.ts");
      return createPostgresStorage({
        connectionString:
          env("DATABASE_URL") || env("POSTGRES_URL", "postgres://localhost:5432/postgres"),
        table: env("STORAGE_PG_TABLE", "xtandard_links"),
      });
    }
    case "mongodb": {
      const { createMongoStorage } = await import("./storage/mongodb.ts");
      return createMongoStorage({
        url: env("MONGO_URL", "mongodb://localhost:27017"),
        dbName: env("MONGO_DB", "xtandard_links"),
        collectionName: env("STORAGE_MONGO_COLLECTION", "links"),
      });
    }
    case "sqlite": {
      // Requires running the CLI under Bun (`bunx xtandard-links …`).
      const { createSqliteStorage } = await import("./storage/sqlite.ts");
      return createSqliteStorage({ path: env("STORAGE_SQLITE_PATH", "./.links/links.sqlite") });
    }
    case "libsql": {
      const { createLibsqlStorage } = await import("./storage/libsql.ts");
      const authToken = env("LIBSQL_AUTH_TOKEN");
      return createLibsqlStorage({
        url: env("STORAGE_LIBSQL_URL") || env("LIBSQL_URL", "file:./.links/links.db"),
        ...(authToken ? { authToken } : {}),
      });
    }
    case "memory": {
      if (!memoryStorage) {
        const { createMemoryStorage } = await import("./storage/memory.ts");
        memoryStorage = createMemoryStorage();
      }
      return memoryStorage;
    }
    case "file":
    default: {
      const { createFileStorage } = await import("./storage/file.ts");
      return createFileStorage({ dir: env("STORAGE_FILE_DIR", "./.links/storage") });
    }
  }
}

/**
 * A log-safe description of where storage persists data, for the `serve`
 * banner: file/SQLite paths resolved to absolute, connection-string drivers
 * by name only (URLs may carry credentials).
 */
async function describeStorage(): Promise<string> {
  const { resolve } = await import("node:path");
  const driver = (env("STORAGE_DRIVER", "file") as Driver) || "file";
  switch (driver) {
    case "file":
      return `file → ${resolve(env("STORAGE_FILE_DIR", "./.links/storage"))}`;
    case "sqlite":
      return `sqlite → ${resolve(env("STORAGE_SQLITE_PATH", "./.links/links.sqlite"))}`;
    case "memory":
      return "memory (ephemeral — not persisted)";
    default:
      return driver;
  }
}

/** `AUTH_MODE`, with an empty value meaning the default `none`. */
const authModeFromEnv = (): string => process.env.AUTH_MODE || "none";

/** Build the auth + authorization providers from env (mirrors the standalone app). */
async function buildAuth(): Promise<{ auth: AuthProvider; authorization: AuthorizationProvider }> {
  const mode = authModeFromEnv();
  if (mode === "basic") {
    const [{ basicAuth }, { rolesAuthorization }] = await Promise.all([
      import("./auth/basic.ts"),
      import("./authorization/roles.ts"),
    ]);
    const passwordHash = env("AUTH_PASSWORD_HASH");
    const password = env("AUTH_PASSWORD");
    if (!passwordHash && !password) {
      err(
        "[xtandard/links] AUTH_MODE=basic but neither AUTH_PASSWORD_HASH nor AUTH_PASSWORD is set.\n",
      );
    }
    return {
      auth: basicAuth({
        realm: "xtandard-links",
        users: [
          {
            username: env("AUTH_USERNAME", "admin"),
            ...(passwordHash ? { passwordHash } : {}),
            ...(password ? { password } : {}),
            roles: ["admin"],
          },
        ],
      }),
      authorization: rolesAuthorization({}),
    };
  }
  if (mode !== "none") throw new Error(`Unknown AUTH_MODE "${mode}" (expected none or basic)`);
  const [{ noAuth }, { noAuthorization }] = await Promise.all([
    import("./auth/none.ts"),
    import("./authorization/none.ts"),
  ]);
  return { auth: noAuth(), authorization: noAuthorization() };
}

type FetchHandler = (request: Request) => Response | Promise<Response>;

/**
 * Serve a web-standard fetch handler under whatever runtime the CLI runs on:
 * `Bun.serve` under `bunx`, a `node:http` bridge under `npx`/Node.
 */
async function startServer(port: number, fetch: FetchHandler): Promise<void> {
  const bun = (globalThis as { Bun?: { serve: (options: unknown) => unknown } }).Bun;
  if (bun) {
    bun.serve({ port, fetch });
    return;
  }
  const { createServer } = await import("node:http");
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const method = req.method ?? "GET";
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (v === undefined) continue;
          headers.set(k, Array.isArray(v) ? v.join(", ") : v);
        }
        const host = req.headers.host ?? `localhost:${port}`;
        const url = `http://${host}${req.url ?? "/"}`;
        const hasBody = method !== "GET" && method !== "HEAD" && chunks.length > 0;
        const request = new Request(url, {
          method,
          headers,
          body: hasBody ? Buffer.concat(chunks) : undefined,
        });
        const response = await fetch(request);
        res.statusCode = response.status;
        const cookies = response.headers.getSetCookie?.() ?? [];
        response.headers.forEach((value, key) => {
          if (key !== "set-cookie") res.setHeader(key, value);
        });
        if (cookies.length) res.setHeader("set-cookie", cookies);
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (e) {
        res.statusCode = 500;
        res.end(`Internal error: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(port, resolve));
}

type Flags = Record<string, string | boolean>;

/** Single-letter flags that take a value. */
const SHORT: Record<string, string> = { o: "output", t: "tenant", p: "port", f: "format" };

/** Minimal argv parser: `--key value`, `--key=value`, `--flag`, `-o value`. */
function parseArgs(argv: string[]): { _: string[]; flags: Flags } {
  const _: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else {
        flags[key] = next;
        i++;
      }
    } else if (/^-[a-z]$/.test(a) && SHORT[a.slice(1)]) {
      const next = argv[i + 1];
      if (next !== undefined) {
        flags[SHORT[a.slice(1)] as string] = next;
        i++;
      }
    } else if (a === "-h" || a === "-v") {
      flags[a === "-h" ? "help" : "version"] = true;
    } else _.push(a);
  }
  return { _, flags };
}

const str = (flags: Flags, key: string): string | undefined =>
  typeof flags[key] === "string" ? (flags[key] as string) : undefined;

const list = (value: string | undefined): string[] | undefined =>
  value
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** A core over the env-configured storage. */
async function makeCore(): Promise<LinksCore> {
  const storage = await buildStorage();
  const defaultDomain = env("DEFAULT_DOMAIN");
  return createLinksCore({
    storage,
    counterFlushMs: 0,
    ...(defaultDomain ? { defaultDomain } : {}),
  });
}

const tenantOf = (flags: Flags) => str(flags, "tenant") ?? env("TENANT", DEFAULT_TENANT);

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));

function shortUrlOf(link: Pick<Link, "domain" | "slug">): string {
  const local = link.domain === "localhost" || link.domain.endsWith(".localhost");
  return `${local ? "http" : "https"}://${link.domain}/${link.slug}`;
}

function formatLink(link: Link): string {
  const flags = [
    link.disabled ? "disabled" : "",
    link.archived ? "archived" : "",
    link.password ? "password" : "",
  ].filter(Boolean);
  return (
    `${link.id}  ${pad(shortUrlOf(link), 32)} → ${link.url}` +
    `${link.tags.length ? `  [${link.tags.join(",")}]` : ""}` +
    `${flags.length ? `  (${flags.join(", ")})` : ""}` +
    `  ${link.clicks ?? 0} clicks\n`
  );
}

/** Find a link by id, then by `domain/slug` or slug (on `--domain` / the default domain). */
async function findLink(core: LinksCore, tenant: string, ref: string, domain?: string) {
  const byId = await core.getLink(tenant, ref);
  if (byId) return byId;
  const slash = ref.indexOf("/");
  if (slash > 0 && ref.slice(0, slash).includes(".")) {
    const found = await core.getLinkBySlug(ref.slice(0, slash), ref.slice(slash + 1));
    if (found) return found;
  }
  const domains = domain
    ? [domain]
    : (await core.listDomains({ tenant })).map((d) => d.hostname).sort();
  for (const host of domains) {
    const found = await core.getLinkBySlug(host, ref);
    if (found && found.tenant === tenant) return found;
  }
  return null;
}

async function writeOrPrint(path: string | undefined, content: string): Promise<void> {
  if (!path || path === "-") {
    out(content);
    return;
  }
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, content);
}

function helpText(): string {
  return `xtandard-links v${VERSION} — self-hosted branded short links: redirects, analytics, conversions, deep links

Usage:
  xtandard-links <command> [options]     # the binary, after: npm i -g @xtandard/links
  npx @xtandard/links <command>          # without installing (or: bunx @xtandard/links …)

Commands:
  serve [--port <n>] [--base-path /links] [--domain <host>]
                                Run the admin panel (at --base-path) and the redirect
                                handler (every other path) on one port.
  links create --url <url> [--slug <s>] [--domain <host>] [--tag a,b] [--title <t>]
  links list [--search <q>] [--tag <t>] [--archived true|false|all] [--limit <n>]
  links get <id|slug|domain/slug>
  links delete <id|slug|domain/slug>
  domains add <hostname> [--default] [--root-url <url>] [--not-found-url <url>]
  domains list
  domains remove <hostname> [--force]
  import <file.csv> [--format auto|native|bitly|dub|shlink|kutt] [--dry-run]
                    [--on-conflict skip|update|error] [--domain <host>] [--keep-domains]
                                Bulk-import links from a CSV export.
  export [-o links.csv]         Export links as CSV (native format, re-importable).
  stats <tenant> [--link <id|slug>] [--days <n>]
                                Clicks, leads and sales (daily) + top countries/referrers.
  qr <url|slug> [-o code.svg] [--size <px>]
                                QR code SVG for a URL or a link's short URL (+ ?qr=1).
  prune                         Drop expired click refs, deferred handoffs and KV analytics buckets.

Common options:
  --tenant, -t <key>            Tenant (default: $TENANT or "default").
  -h, --help                    Show this help.
  -v, --version                 Print the version.

Environment variables
  Storage:
    STORAGE_DRIVER              memory | file | redis | postgres | mongodb | sqlite | libsql
                                (CLI default: file · Docker default: memory)
    REDIS_URL, STORAGE_PREFIX   redis://localhost:6379, xtandard:links       (driver: redis)
    DATABASE_URL | POSTGRES_URL, STORAGE_PG_TABLE (xtandard_links)           (driver: postgres)
    MONGO_URL, MONGO_DB, STORAGE_MONGO_COLLECTION                            (driver: mongodb)
    STORAGE_FILE_DIR            default ./.links/storage                     (driver: file)
    STORAGE_SQLITE_PATH         default ./.links/links.sqlite                (driver: sqlite, Bun only)
    LIBSQL_URL | STORAGE_LIBSQL_URL, LIBSQL_AUTH_TOKEN                       (driver: libsql)
  Links:
    DEFAULT_DOMAIN              Shared domain for links that name none (serve default: localhost).
    TENANT                      Default tenant for CLI commands.
  Server  (\`serve\` / standalone):
    PORT            3000        Port to listen on (or --port).
    BASE_PATH       /links      Panel mount path (or --base-path).
    REDIRECT_BASE_PATH          Also serve links under this prefix on any host (e.g. /l).
    TITLE                       Navbar wordmark.
    LOGO_URL                    Logo image URL.
    READONLY        1|true      Block all mutating operations.
    AUTH_MODE       none|basic  Authentication mode (default none; any other value is rejected).
    AUTH_USERNAME   admin       Username for basic auth.
    AUTH_PASSWORD_HASH          scrypt hash (preferred; see docs/AUTH.md).
    AUTH_PASSWORD               Plaintext password (dev only).
    VIEWER_SECRET               Enables analytics viewer tokens (lvt_… bearer tokens).
    VISITOR_SALT                Shared salt for visitor hashes (set it when running several instances).

Examples:
  # Local panel + redirects (file storage, no auth): http://localhost:3000/links
  npx @xtandard/links serve
  # Create a link and open it:
  xtandard-links links create --url https://example.com --slug hello
  curl -i http://localhost:3000/hello
  # Migrate from Bitly:
  xtandard-links import bitly-export.csv --format bitly --tenant acme --dry-run
  # QR code for a link:
  xtandard-links qr hello -o hello.svg

Docs: https://me.xantiagoma.com/xtandard-links/
`;
}

/** Entry point. Returns the process exit code. */
export async function run(argv: string[]): Promise<number> {
  const { _, flags } = parseArgs(argv);
  const [command, sub, arg] = _;
  if (flags.version === true || command === "version") {
    out(`${VERSION}\n`);
    return 0;
  }
  const wantsHelp = Boolean(flags.help) || command === "help";
  if (!command || wantsHelp) {
    out(helpText());
    return wantsHelp ? 0 : 1;
  }
  try {
    switch (command) {
      case "links":
        return await linksCommand(sub, arg, flags);
      case "domains":
        return await domainsCommand(sub, arg, flags);
      case "import": {
        const file = sub;
        if (!file) {
          err(
            "Usage: xtandard-links import <file.csv> [--format auto|native|bitly|dub|shlink|kutt] [--dry-run] [--on-conflict skip|update|error]\n",
          );
          return 1;
        }
        const { readFile } = await import("node:fs/promises");
        const { parseLinksCsv, LINKS_CSV_FORMATS } = await import("./import.ts");
        const format = str(flags, "format") ?? "auto";
        if (format !== "auto" && !(LINKS_CSV_FORMATS as readonly string[]).includes(format)) {
          err(`Unknown --format "${format}" (auto, ${LINKS_CSV_FORMATS.join(", ")}).\n`);
          return 1;
        }
        const onConflict = str(flags, "on-conflict") ?? "skip";
        if (!["skip", "update", "error"].includes(onConflict)) {
          err("--on-conflict must be skip, update or error.\n");
          return 1;
        }
        const domain = str(flags, "domain");
        const tags = list(str(flags, "tag"));
        const rows = parseLinksCsv(await readFile(file, "utf8"), {
          format: format as "auto",
          ...(domain ? { domain } : {}),
          ...(flags["keep-domains"] === true ? { keepDomains: true } : {}),
          ...(tags ? { tags } : {}),
        });
        const core = await makeCore();
        const dryRun = flags["dry-run"] === true;
        const result = await core.importLinks(tenantOf(flags), rows, {
          dryRun,
          onConflict: onConflict as ImportConflictPolicy,
          actor: { id: "cli" },
        });
        for (const row of result.rows) {
          if (row.status === "error") err(`row ${row.index + 2}: ${row.error}\n`);
        }
        out(
          `${dryRun ? "Dry run: " : ""}${result.created} created, ${result.updated} updated, ` +
            `${result.skipped} skipped, ${result.errors} errors (${rows.length} rows).\n`,
        );
        await core.close();
        return result.errors > 0 ? 2 : 0;
      }
      case "export": {
        const core = await makeCore();
        const tenant = tenantOf(flags);
        const links: Link[] = [];
        let cursor: string | undefined;
        do {
          const page = await core.listLinks(tenant, {
            archived: "all",
            limit: 500,
            ...(cursor ? { cursor } : {}),
          });
          links.push(...page.links);
          cursor = page.nextCursor;
        } while (cursor);
        const { linksToCsv } = await import("./import.ts");
        await writeOrPrint(str(flags, "output"), linksToCsv(links.map(publicLink)));
        if (str(flags, "output")) out(`Exported ${links.length} links.\n`);
        return 0;
      }
      case "stats": {
        const tenant = sub ?? tenantOf(flags);
        const core = await makeCore();
        const days = Number(str(flags, "days") ?? "30");
        if (!Number.isFinite(days) || days <= 0) {
          err("--days must be a positive number.\n");
          return 1;
        }
        let linkIds: string[] | undefined;
        const linkRef = str(flags, "link");
        if (linkRef) {
          const link = await findLink(core, tenant, linkRef, str(flags, "domain"));
          if (!link) {
            err(`Link "${linkRef}" not found in tenant "${tenant}".\n`);
            return 1;
          }
          linkIds = [link.id];
        }
        const to = new Date(Math.ceil(Date.now() / 86_400_000) * 86_400_000);
        const from = new Date(to.getTime() - days * 86_400_000);
        const base = {
          tenant,
          from: from.toISOString(),
          to: to.toISOString(),
          ...(linkIds ? { linkIds } : {}),
        };
        const series = await core.queryAnalytics({ ...base, interval: "day" });
        const t = series.totals;
        out(
          `${tenant}${linkRef ? ` / ${linkRef}` : ""} — last ${days} days\n` +
            `  clicks ${t.clicks}  bots ${t.botClicks}  leads ${t.leads}  sales ${t.sales}` +
            `  revenue ${(t.saleAmount / 100).toFixed(2)}\n\n`,
        );
        for (const b of series.timeseries ?? []) {
          if (b.clicks || b.leads || b.sales) {
            out(
              `  ${b.at.slice(0, 10)}  ${pad(String(b.clicks), 6)} ${"▇".repeat(Math.min(b.clicks, 60))}\n`,
            );
          }
        }
        for (const groupBy of ["country", "referrer", "device"] as const) {
          try {
            const r = await core.queryAnalytics({ ...base, groupBy, limit: 5 });
            const rows = (r.breakdown ?? []).filter((row) => row.clicks > 0);
            if (rows.length) {
              out(
                `\n  top ${groupBy}: ${rows.map((row) => `${row.key} ${row.clicks}`).join(", ")}\n`,
              );
            }
          } catch {
            // the sink cannot answer this breakdown; skip it
          }
        }
        await core.close();
        return 0;
      }
      case "qr": {
        const target = sub;
        if (!target) {
          err("Usage: xtandard-links qr <url|slug> [-o code.svg] [--size <px>]\n");
          return 1;
        }
        const { qrUrl, renderQrSvg } = await import("./qr.ts");
        let text = target;
        if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) {
          const core = await makeCore();
          const link = await findLink(core, tenantOf(flags), target, str(flags, "domain"));
          if (!link) {
            err(`Link "${target}" not found.\n`);
            return 1;
          }
          text = qrUrl(link);
        }
        const size = Number(str(flags, "size") ?? "512");
        await writeOrPrint(str(flags, "output"), renderQrSvg(text, { size }) + "\n");
        if (str(flags, "output")) out(`Wrote ${str(flags, "output")} (${text}).\n`);
        return 0;
      }
      case "prune": {
        const core = await makeCore();
        const result = await core.prune();
        out(`Pruned ${result.clickRefs} click refs and ${result.deferred} deferred handoffs.\n`);
        // The default KV rollup sink keeps hourly buckets for a bounded window.
        const analytics = core.analytics as {
          prune?: () => Promise<{ buckets: number; events: number }>;
        };
        if (typeof analytics.prune === "function") {
          const rollups = await analytics.prune();
          out(`Pruned ${rollups.buckets} analytics buckets and ${rollups.events} recent events.\n`);
        }
        return 0;
      }
      case "serve":
        return await serve(flags);
      default:
        err(`Unknown command: ${command}\n\n${helpText()}`);
        return 1;
    }
  } catch (e) {
    err(`Error: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

async function linksCommand(
  sub: string | undefined,
  ref: string | undefined,
  flags: Flags,
): Promise<number> {
  const tenant = tenantOf(flags);
  switch (sub) {
    case "create": {
      const url = str(flags, "url") ?? ref;
      if (!url) {
        err("Usage: xtandard-links links create --url <url> [--slug <s>] [--domain <host>]\n");
        return 1;
      }
      const core = await makeCore();
      const slug = str(flags, "slug");
      const domain = str(flags, "domain");
      const title = str(flags, "title");
      const tags = list(str(flags, "tag") ?? str(flags, "tags"));
      const link = await core.createLink(
        {
          tenant,
          url,
          ...(slug ? { slug } : {}),
          ...(domain ? { domain } : {}),
          ...(title ? { title } : {}),
          ...(tags ? { tags } : {}),
        },
        { actor: { id: "cli" } },
      );
      out(`${shortUrlOf(link)}\n`);
      if (flags.json === true) out(`${JSON.stringify(publicLink(link), null, 2)}\n`);
      return 0;
    }
    case "list":
    case "ls": {
      const core = await makeCore();
      const archived = str(flags, "archived");
      const search = str(flags, "search");
      const tag = str(flags, "tag");
      const domain = str(flags, "domain");
      const page = await core.listLinks(tenant, {
        ...(search ? { search } : {}),
        ...(tag ? { tag } : {}),
        ...(domain ? { domain } : {}),
        ...(archived === "all"
          ? { archived: "all" }
          : archived === "true"
            ? { archived: true }
            : {}),
        limit: Number(str(flags, "limit") ?? "100"),
      });
      if (flags.json === true) {
        out(`${JSON.stringify(page.links.map(publicLink), null, 2)}\n`);
        return 0;
      }
      if (page.links.length === 0) out("No links.\n");
      for (const link of page.links) out(formatLink(link));
      if (page.total > page.links.length) out(`… ${page.total - page.links.length} more\n`);
      return 0;
    }
    case "get": {
      if (!ref) {
        err("Usage: xtandard-links links get <id|slug|domain/slug>\n");
        return 1;
      }
      const core = await makeCore();
      const link = await findLink(core, tenant, ref, str(flags, "domain"));
      if (!link) {
        err(`Link "${ref}" not found in tenant "${tenant}".\n`);
        return 1;
      }
      link.clicks = await core.getClickCount(link.tenant, link.id);
      out(`${JSON.stringify(publicLink(link), null, 2)}\n`);
      return 0;
    }
    case "delete":
    case "rm": {
      if (!ref) {
        err("Usage: xtandard-links links delete <id|slug|domain/slug>\n");
        return 1;
      }
      const core = await makeCore();
      const link = await findLink(core, tenant, ref, str(flags, "domain"));
      if (!link) {
        err(`Link "${ref}" not found in tenant "${tenant}".\n`);
        return 1;
      }
      await core.deleteLink(link.tenant, link.id, { actor: { id: "cli" } });
      out(`Deleted ${shortUrlOf(link)} (${link.id}).\n`);
      return 0;
    }
    default:
      err("Usage: xtandard-links links <create|list|get|delete> …\n");
      return 1;
  }
}

async function domainsCommand(
  sub: string | undefined,
  hostname: string | undefined,
  flags: Flags,
): Promise<number> {
  switch (sub) {
    case "add": {
      if (!hostname) {
        err("Usage: xtandard-links domains add <hostname> [--tenant <key>] [--default]\n");
        return 1;
      }
      const core = await makeCore();
      const tenant = str(flags, "tenant");
      const rootUrl = str(flags, "root-url");
      const notFoundUrl = str(flags, "not-found-url");
      const domain = await core.createDomain(
        {
          hostname,
          ...(tenant ? { tenant } : {}),
          ...(flags.default === true ? { isDefault: true } : {}),
          ...(rootUrl ? { rootUrl } : {}),
          ...(notFoundUrl ? { notFoundUrl } : {}),
        },
        { actor: { id: "cli" } },
      );
      out(
        `Added ${domain.hostname}${domain.tenant ? ` (tenant ${domain.tenant})` : " (shared)"}.\n`,
      );
      return 0;
    }
    case "list":
    case "ls": {
      const core = await makeCore();
      const tenant = str(flags, "tenant");
      const domains = await core.listDomains(tenant ? { tenant } : {});
      if (domains.length === 0) out("No domains.\n");
      for (const d of domains) {
        out(
          `${d.isDefault ? "★" : " "} ${pad(d.hostname, 32)} ${d.tenant ? `tenant:${d.tenant}` : "shared"}\n`,
        );
      }
      return 0;
    }
    case "remove":
    case "rm": {
      if (!hostname) {
        err("Usage: xtandard-links domains remove <hostname> [--force]\n");
        return 1;
      }
      const core = await makeCore();
      await core.deleteDomain(hostname, { force: flags.force === true, actor: { id: "cli" } });
      out(`Removed ${hostname}.\n`);
      return 0;
    }
    default:
      err("Usage: xtandard-links domains <add|list|remove> …\n");
      return 1;
  }
}

/** `serve`: panel at the base path, redirects everywhere else, one port. */
async function serve(flags: Flags): Promise<number> {
  const port = Number(str(flags, "port") ?? env("PORT", "3000"));
  const basePathRaw = str(flags, "base-path") ?? env("BASE_PATH", "/links");
  const defaultDomain = (str(flags, "domain") ?? env("DEFAULT_DOMAIN", "localhost")).toLowerCase();
  const title = env("TITLE", "@xtandard/links");
  const logoUrl = env("LOGO_URL");
  const readonly = isTruthy(env("READONLY"));
  const authMode = authModeFromEnv();
  const viewerSecret = env("VIEWER_SECRET") || env("PORTAL_SECRET");
  const redirectBasePath = env("REDIRECT_BASE_PATH");

  const [{ createFetchHandler }, { createRedirectHandler }, { normalizeBasePath }] =
    await Promise.all([
      import("./server/create-fetch-handler.ts"),
      import("./redirect.ts"),
      import("./server/base-path.ts"),
    ]);
  // Auth first: an unknown AUTH_MODE fails before storage connects or anything listens.
  const { auth, authorization } = await buildAuth();
  const storage = await buildStorage();
  if (authMode === "none") {
    err("[xtandard/links] AUTH_MODE=none — do NOT expose this publicly without authentication.\n");
  }
  const basePath = normalizeBasePath(basePathRaw);
  const core = createLinksCore({ storage, readonly, defaultDomain });
  const panel = createFetchHandler({
    core,
    basePath,
    title,
    readonly,
    auth,
    authorization,
    ...(logoUrl ? { logoUrl } : {}),
    ...(viewerSecret ? { portal: { secret: viewerSecret } } : {}),
    ...(redirectBasePath ? { redirectBasePath } : {}),
  });
  const visitorSalt = env("VISITOR_SALT");
  const redirects = createRedirectHandler({
    core,
    defaultDomain,
    // A shared salt keeps unique visitors, A/B stickiness and deferred fingerprints stable
    // across instances and restarts (the default is random per process).
    ...(visitorSalt ? { privacy: { salt: visitorSalt } } : {}),
    ...(redirectBasePath ? { basePath: redirectBasePath } : {}),
  });
  // Make sure the default domain exists so the first link works out of the box.
  await core.listDomains();

  const inPanel = (pathname: string) =>
    basePath !== "" && (pathname === basePath || pathname.startsWith(`${basePath}/`));
  const handler: FetchHandler = async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/healthcheck") {
      return new Response(JSON.stringify({ status: "ok", title, version: VERSION }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (inPanel(url.pathname)) return panel.fetch(request);
    const response = await redirects.handle(request);
    if (response) return response;
    // Panel at the root: everything that is not a short link is the panel.
    if (basePath === "") return panel.fetch(request);
    if (url.pathname === "/") {
      return new Response(null, { status: 302, headers: { location: `${basePath}/` } });
    }
    return redirects.fetch(request);
  };

  out(`[xtandard/links] storage: ${await describeStorage()}\n`);
  out(`[xtandard/links] default domain: ${defaultDomain}\n`);
  await startServer(port, handler);
  out(`[xtandard/links] panel on http://localhost:${port}${basePath || "/"}\n`);
  out(`[xtandard/links] redirects on http://localhost:${port}/{slug}\n`);
  // The server owns the process now; never resolve so the bin doesn't exit.
  return await new Promise<number>(() => {});
}
