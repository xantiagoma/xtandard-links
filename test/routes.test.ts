import { describe, expect, test } from "vitest";
import { createLinksCore, HookDeniedError, type Link } from "../src/index.ts";
import { createFetchHandler, type LinksPanelOptions } from "../src/server/create-fetch-handler.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";
import { createCollectingSink, createTestLinks, clickRequest } from "../src/testing.ts";

type Json = Record<string, any>;

function setup(options: Partial<LinksPanelOptions> = {}) {
  const sink = createCollectingSink();
  const panel = createFetchHandler({
    storage: createMemoryStorage(),
    analytics: sink,
    defaultDomain: "sho.rt",
    uiDir: "/nonexistent-ui-dir",
    ...options,
  });
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const init: RequestInit = { method, headers: { ...headers } };
    if (body !== undefined) {
      if (typeof body === "string") init.body = body;
      else {
        init.body = JSON.stringify(body);
        (init.headers as Record<string, string>)["content-type"] = "application/json";
      }
    }
    const res = await panel.fetch(new Request(`http://admin.test${path}`, init));
    const type = res.headers.get("content-type") ?? "";
    const data = type.includes("json") ? ((await res.json()) as Json) : await res.text();
    return { status: res.status, data: data as any, res };
  };
  return { panel, sink, core: panel.core, call };
}

describe("meta routes", () => {
  test("/config reports panel settings and sink capabilities", async () => {
    const { call } = setup({ title: "Acme Links", logoUrl: "/logo.svg" });
    const { status, data } = await call("GET", "/config");
    expect(status).toBe(200);
    expect(data).toMatchObject({
      title: "Acme Links",
      logoUrl: "/logo.svg",
      basePath: "",
      readonly: false,
      authenticated: true,
      viewer: false,
      viewerTokens: false,
      capabilities: { events: true, crossFilter: true },
      principal: { id: "anonymous" },
    });
    expect(typeof data.version).toBe("string");
    expect((await call("GET", "/api/config")).status).toBe(200);
  });

  test("healthcheck and openapi are public", async () => {
    const { call } = setup({ basePath: "/links" });
    expect((await call("GET", "/links/healthcheck")).data).toMatchObject({ status: "ok" });
    const doc = (await call("GET", "/links/api/openapi.json")).data;
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.servers[0].url).toBe("/links");
  });

  test("SPA fallback injects the bootstrap config; asset-looking misses 404", async () => {
    const { call } = setup({ basePath: "/links", title: "T<x>" });
    const page = await call("GET", "/links/some/route");
    expect(page.status).toBe(200);
    expect(page.data).toContain("window.__LINKS_CONFIG__=");
    expect(page.data).toContain('<base href="/links/">');
    expect(page.data).not.toContain("T<x>");
    expect((await call("GET", "/links/missing.js")).status).toBe(404);
    expect((await call("POST", "/links/some/route")).status).toBe(405);
  });

  test("serves the built UI when present", async () => {
    const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "links-ui-"));
    writeFileSync(join(dir, "index.html"), "<html><head></head><body>app</body></html>");
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
    const { call } = setup({ uiDir: dir, basePath: "/links" });
    const index = await call("GET", "/links/");
    expect(index.data).toContain('<head><base href="/links/"><script>window.__LINKS_CONFIG__');
    const asset = await call("GET", "/links/assets/app.js");
    expect(asset.status).toBe(200);
    expect(asset.res.headers.get("cache-control")).toContain("immutable");
  });

  test("unknown API routes 404, wrong methods 405", async () => {
    const { call } = setup();
    expect((await call("GET", "/api/nope")).status).toBe(404);
    expect((await call("PUT", "/api/tenants/default/links")).status).toBe(405);
  });

  test("requires storage or core", () => {
    expect(() => createFetchHandler({})).toThrow(/storage/);
  });

  test("accepts a prebuilt core", async () => {
    const core = createLinksCore({ storage: createMemoryStorage(), defaultDomain: "x.co" });
    const panel = createFetchHandler({ core });
    expect(panel.core).toBe(core);
    expect(panel.openapi()).toMatchObject({ openapi: "3.1.0" });
  });
});

describe("tenants", () => {
  test("upsert, list, get, delete", async () => {
    const { call } = setup();
    const put = await call("PUT", "/api/tenants/acme", { name: "Acme", createdAt: "ignored" });
    expect(put.status).toBe(200);
    expect(put.data).toMatchObject({ key: "acme", name: "Acme" });
    expect((await call("GET", "/api/tenants")).data.map((t: Json) => t.key)).toEqual(["acme"]);
    expect((await call("GET", "/api/tenants/acme")).data.name).toBe("Acme");
    expect((await call("GET", "/api/tenants/nope")).status).toBe(404);
    expect((await call("DELETE", "/api/tenants/acme")).data).toEqual({ ok: true });
    expect((await call("DELETE", "/api/tenants/acme")).status).toBe(404);
  });

  test("validates the body", async () => {
    const { call } = setup();
    const res = await call("PUT", "/api/tenants/acme", { name: 42 });
    expect(res.status).toBe(400);
    expect(res.data.code).toBe("VALIDATION");
    expect(res.data.errors.length).toBeGreaterThan(0);
    expect(
      (await call("PUT", "/api/tenants/acme", "[1]", { "content-type": "application/json" }))
        .status,
    ).toBe(400);
    expect(
      (await call("PUT", "/api/tenants/acme", "{nope", { "content-type": "application/json" }))
        .data,
    ).toMatchObject({ error: "Invalid JSON body" });
  });
});

describe("domains", () => {
  test("CRUD with tenant scoping and force delete", async () => {
    const { call } = setup();
    const created = await call("POST", "/api/domains", { hostname: "Go.Acme.com", tenant: "acme" });
    expect(created.status).toBe(201);
    expect(created.data.hostname).toBe("go.acme.com");
    expect((await call("POST", "/api/domains", { hostname: "go.acme.com" })).status).toBe(409);
    expect((await call("POST", "/api/domains", { hostname: "not a host" })).status).toBe(400);

    const all = (await call("GET", "/api/domains")).data.map((d: Json) => d.hostname);
    expect(all).toEqual(["go.acme.com", "sho.rt"]);
    const other = (await call("GET", "/api/domains?tenant=other")).data.map(
      (d: Json) => d.hostname,
    );
    expect(other).toEqual(["sho.rt"]);

    expect((await call("GET", "/api/domains/go.acme.com")).data.tenant).toBe("acme");
    expect((await call("GET", "/api/domains/nope.com")).status).toBe(404);
    const updated = await call("PUT", "/api/domains/go.acme.com", {
      rootUrl: "https://acme.com",
      hostname: "ignored.com",
    });
    expect(updated.data).toMatchObject({ hostname: "go.acme.com", rootUrl: "https://acme.com" });

    await call("POST", "/api/tenants/acme/links", { url: "https://a.com", domain: "go.acme.com" });
    const blocked = await call("DELETE", "/api/domains/go.acme.com");
    expect(blocked.status).toBe(409);
    expect(blocked.data.code).toBe("CONFLICT");
    expect((await call("DELETE", "/api/domains/go.acme.com?force=true")).data).toEqual({
      ok: true,
    });
    expect((await call("GET", "/api/tenants/acme/links")).data.total).toBe(0);
  });
});

describe("links", () => {
  test("create, list, get, patch, delete; password hash never leaves", async () => {
    const { call } = setup();
    const created = await call("POST", "/api/tenants/acme/links", {
      url: "https://example.com/launch",
      slug: "launch",
      tags: ["spring", "ads"],
      password: "hunter2",
      tenant: "ignored",
    });
    expect(created.status).toBe(201);
    const link = created.data as Link & { hasPassword: boolean };
    expect(link).toMatchObject({
      tenant: "acme",
      domain: "sho.rt",
      slug: "launch",
      hasPassword: true,
    });
    expect("password" in link).toBe(false);

    const page = (await call("GET", "/api/tenants/acme/links")).data;
    expect(page.total).toBe(1);
    expect(page.links[0].hasPassword).toBe(true);
    expect(page.links[0].password).toBeUndefined();

    const got = await call("GET", `/api/tenants/acme/links/${link.id}`);
    expect(got.data).toMatchObject({ id: link.id, clicks: 0 });
    expect(got.data.password).toBeUndefined();
    expect((await call("GET", "/api/tenants/other/links/" + link.id)).status).toBe(404);

    const patched = await call("PATCH", `/api/tenants/acme/links/${link.id}`, {
      title: "Launch",
      password: null,
      tenant: "evil",
    });
    expect(patched.data).toMatchObject({ title: "Launch", hasPassword: false, tenant: "acme" });

    expect((await call("DELETE", `/api/tenants/acme/links/${link.id}`)).data).toEqual({ ok: true });
    expect((await call("GET", `/api/tenants/acme/links/${link.id}`)).status).toBe(404);
    expect((await call("DELETE", `/api/tenants/acme/links/${link.id}`)).status).toBe(404);
  });

  test("errors: validation 400, unknown domain 404, slug conflict 409", async () => {
    const { call } = setup();
    const bad = await call("POST", "/api/tenants/acme/links", { url: "javascript:alert(1)" });
    expect(bad.status).toBe(400);
    expect(bad.data.errors[0].path).toBe("link.url");
    expect(
      (await call("POST", "/api/tenants/acme/links", { url: "https://a.com", domain: "nope.com" }))
        .status,
    ).toBe(404);
    await call("POST", "/api/tenants/acme/links", { url: "https://a.com", slug: "x" });
    const dup = await call("POST", "/api/tenants/acme/links", { url: "https://b.com", slug: "X" });
    expect(dup.status).toBe(409);
    expect(dup.data.code).toBe("CONFLICT");
  });

  test("list filters and cursor paging", async () => {
    const { call } = setup();
    for (let i = 0; i < 5; i++) {
      await call("POST", "/api/tenants/acme/links", {
        url: `https://example.com/${i}`,
        slug: `s${i}`,
        tags: i % 2 ? ["odd"] : ["even"],
        ...(i === 4 ? { archived: true } : {}),
      });
    }
    const q = async (query: string) => (await call("GET", `/api/tenants/acme/links?${query}`)).data;
    expect((await q("")).total).toBe(4);
    expect((await q("archived=all")).total).toBe(5);
    expect((await q("archived=true")).links.map((l: Json) => l.slug)).toEqual(["s4"]);
    expect((await q("tag=odd")).total).toBe(2);
    expect((await q("search=example.com/3")).links.map((l: Json) => l.slug)).toEqual(["s3"]);
    expect((await q("domain=other.com")).total).toBe(0);
    const first = await q("limit=2");
    expect(first.links).toHaveLength(2);
    const second = await q(`limit=2&cursor=${first.nextCursor}`);
    expect(second.links.map((l: Json) => l.slug)).toEqual(["s1", "s0"]);
    expect(second.nextCursor).toBeUndefined();
    expect((await call("GET", "/api/tenants/acme/links?archived=maybe")).status).toBe(400);
  });

  test("tags", async () => {
    const { call } = setup();
    await call("POST", "/api/tenants/acme/links", { url: "https://a.com", tags: ["a", "b"] });
    await call("POST", "/api/tenants/acme/links", { url: "https://b.com", tags: ["a"] });
    expect((await call("GET", "/api/tenants/acme/tags")).data).toEqual([
      { tag: "a", count: 2 },
      { tag: "b", count: 1 },
    ]);
  });

  test("qr.svg encodes the short URL with ?qr=1", async () => {
    const { call } = setup({ redirectBasePath: "/l" });
    const link = (
      await call("POST", "/api/tenants/acme/links", { url: "https://a.com", slug: "promo" })
    ).data;
    const res = await call(
      "GET",
      `/api/tenants/acme/links/${link.id}/qr.svg?size=300&fg=0d9488&bg=transparent&ecc=h&download=1`,
    );
    expect(res.status).toBe(200);
    expect(res.res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.res.headers.get("content-disposition")).toContain('filename="promo.svg"');
    expect(res.data).toContain('width="300"');
    expect(res.data).toContain('fill="#0d9488"');
    expect(res.data).not.toContain("<rect");
    expect((await call("GET", "/api/tenants/acme/links/lnk_nope/qr.svg")).status).toBe(404);
  });
});

describe("import / export", () => {
  test("JSON rows with dryRun and conflict policies", async () => {
    const { call } = setup();
    const rows = [
      { url: "https://a.com", slug: "a" },
      { url: "not a url", slug: "b" },
    ];
    const dry = await call("POST", "/api/tenants/acme/links/import", { rows, dryRun: true });
    expect(dry.data).toMatchObject({ created: 1, errors: 1 });
    expect((await call("GET", "/api/tenants/acme/links")).data.total).toBe(0);

    const real = await call("POST", "/api/tenants/acme/links/import", { rows });
    expect(real.data).toMatchObject({ created: 1, errors: 1 });
    expect(real.data.rows[0].link.hasPassword).toBe(false);
    expect(real.data.rows[1]).toMatchObject({ index: 1, status: "error" });

    const again = await call("POST", "/api/tenants/acme/links/import?onConflict=update", {
      rows: [{ url: "https://a2.com", slug: "a" }],
    });
    expect(again.data).toMatchObject({ updated: 1 });
    expect((await call("POST", "/api/tenants/acme/links/import", { nope: 1 })).status).toBe(400);
    expect(
      (await call("POST", "/api/tenants/acme/links/import?onConflict=merge", { rows: [] })).status,
    ).toBe(400);
  });

  test("CSV upload (shlink format) and CSV export", async () => {
    const { call } = setup();
    const csv =
      "Short code,Long URL,Title,Tags\r\nabc,https://example.com/1,One,x|y\r\ndef,https://example.com/2,,\r\n";
    const res = await call(
      "POST",
      "/api/tenants/acme/links/import?format=shlink&tags=imported",
      csv,
      {
        "content-type": "text/csv",
      },
    );
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ created: 2, errors: 0 });
    expect(res.data.rows[0].link).toMatchObject({
      slug: "abc",
      title: "One",
      tags: ["x", "y", "imported"],
    });

    const exported = await call("GET", "/api/tenants/acme/links.csv");
    expect(exported.res.headers.get("content-type")).toContain("text/csv");
    expect(exported.res.headers.get("content-disposition")).toContain("acme-links.csv");
    expect(exported.data.split("\r\n")[0]).toMatch(/^id,domain,slug,short_url,url,/);
    expect(exported.data).toContain("https://sho.rt/abc");

    // Round-trip the export into another tenant.
    const back = await call(
      "POST",
      "/api/tenants/beta/links/import",
      exported.data.replace(/sho\.rt\/abc/g, "sho.rt/abc"),
      {
        "content-type": "text/csv",
      },
    );
    expect(back.data.skipped + back.data.errors).toBe(2); // slugs taken on the shared domain

    expect(
      (
        await call("POST", "/api/tenants/acme/links/import?format=excel", "a", {
          "content-type": "text/csv",
        })
      ).status,
    ).toBe(400);
    const broken = await call("POST", "/api/tenants/acme/links/import", 'url\r\n"unterminated', {
      "content-type": "text/csv",
    });
    expect(broken.status).toBe(400);
    expect(broken.data.code).toBe("BAD_CSV");
  });
});

describe("analytics, events, conversions, customers, audit", () => {
  async function withClicks() {
    const t = createTestLinks({ redirect: { conversions: { enabled: true } } });
    const panel = createFetchHandler({ core: t.core, uiDir: "/nonexistent" });
    const a = await t.core.createLink({ tenant: "acme", url: "https://a.com", slug: "a" });
    const b = await t.core.createLink({ tenant: "acme", url: "https://b.com", slug: "b" });
    const r1 = await t.redirects.fetch(clickRequest("https://sho.rt/a", { country: "US" }));
    await t.redirects.fetch(clickRequest("https://sho.rt/a", { country: "DE" }));
    await t.redirects.fetch(clickRequest("https://sho.rt/b", { country: "US" }));
    await t.flush();
    const clickId = new URL(r1.headers.get("location") as string).searchParams.get(
      "xl_id",
    ) as string;
    const get = async (path: string, init?: RequestInit) => {
      const res = await panel.fetch(new Request(`http://admin.test${path}`, init));
      return { status: res.status, data: (await res.json()) as any };
    };
    return { ...t, panel, a, b, clickId, get };
  }

  test("analytics defaults to 30 days by day; groupBy, filters, linkIds", async () => {
    const { get, a } = await withClicks();
    const all = await get("/api/tenants/acme/analytics");
    expect(all.status).toBe(200);
    expect(all.data.totals.clicks).toBe(3);
    expect(all.data.timeseries).toHaveLength(31);
    const byCountry = await get("/api/tenants/acme/analytics?groupBy=country&interval=none");
    expect(byCountry.data.timeseries).toBeUndefined();
    expect(byCountry.data.breakdown).toEqual([
      expect.objectContaining({ key: "US", clicks: 2 }),
      expect.objectContaining({ key: "DE", clicks: 1 }),
    ]);
    const filtered = await get(`/api/tenants/acme/analytics?filter[country]=DE,FR&linkIds=${a.id}`);
    expect(filtered.data.totals.clicks).toBe(1);
    const hourly = await get(
      `/api/tenants/acme/analytics?interval=hour&from=${new Date(Date.now() - 3 * 3_600_000).toISOString()}`,
    );
    expect(hourly.data.timeseries.length).toBeGreaterThanOrEqual(3);
  });

  test("analytics query validation", async () => {
    const { get } = await withClicks();
    for (const q of [
      "interval=week",
      "groupBy=planet",
      "from=nope",
      "filter[planet]=x",
      "from=2030-01-01&to=2029-01-01",
    ]) {
      const res = await get(`/api/tenants/acme/analytics?${q}`);
      expect(res.status, q).toBe(400);
      expect(res.data.code).toBe("VALIDATION");
    }
  });

  test("UnsupportedQueryError from the KV sink maps to 400", async () => {
    const panel = createFetchHandler({ storage: createMemoryStorage(), defaultDomain: "sho.rt" });
    const res = await panel.fetch(
      new Request("http://x/api/tenants/acme/analytics?groupBy=country&filter[device]=mobile"),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as Json).code).toBe("UNSUPPORTED_QUERY");
  });

  test("events: recent first, filters, 501 without events()", async () => {
    const { get, b } = await withClicks();
    const events = await get(`/api/tenants/acme/events?linkIds=${b.id}&types=click&limit=10`);
    expect(events.data).toHaveLength(1);
    expect(events.data[0]).toMatchObject({ type: "click", linkId: b.id });
    expect((await get("/api/tenants/acme/events?types=view")).status).toBe(400);

    const sink = { ...createCollectingSink() } as Json;
    delete sink.events;
    const panel = createFetchHandler({ storage: createMemoryStorage(), analytics: sink as any });
    const res = await panel.fetch(new Request("http://x/api/tenants/acme/events"));
    expect(res.status).toBe(501);
  });

  test("track lead + sale, customers, idempotent invoices, unknown clicks", async () => {
    const { get, clickId, a } = await withClicks();
    const post = (path: string, body: unknown) =>
      get(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const lead = await post("/api/track/lead", { tenant: "acme", clickId, customerId: "cus_1" });
    expect(lead.status).toBe(200);
    expect(lead.data).toMatchObject({ attributed: true, event: { type: "lead", linkId: a.id } });
    const sale = await post("/api/track/sale", {
      tenant: "acme",
      customerId: "cus_1",
      amount: 4900,
      invoiceId: "inv_1",
    });
    expect(sale.data).toMatchObject({ attributed: true, event: { amount: 4900, currency: "USD" } });
    const dup = await post("/api/track/sale", {
      tenant: "acme",
      customerId: "cus_1",
      amount: 4900,
      invoiceId: "inv_1",
    });
    expect(dup.data.duplicate).toBe(true);
    expect(
      (await post("/api/track/lead", { tenant: "acme", clickId: "clk_nope", customerId: "cus_2" }))
        .data,
    ).toEqual({ attributed: false });
    expect(
      (await post("/api/track/sale", { tenant: "acme", customerId: "cus_1", amount: -1 })).status,
    ).toBe(400);

    const customers = await get("/api/tenants/acme/customers");
    expect(customers.data.map((c: Json) => c.id)).toEqual(["cus_1"]);
    const totals = (await get("/api/tenants/acme/analytics")).data.totals;
    expect(totals).toMatchObject({ leads: 1, sales: 1, saleAmount: 4900 });
  });

  test("audit logs: tenant and global", async () => {
    const { call } = setup();
    await call("POST", "/api/tenants/acme/links", { url: "https://a.com" });
    await call("PUT", "/api/tenants/gone", {});
    await call("DELETE", "/api/tenants/gone");
    const tenantLog = (await call("GET", "/api/tenants/acme/audit")).data;
    expect(tenantLog[0]).toMatchObject({ action: "link.created", actor: { id: "anonymous" } });
    const global = (await call("GET", "/api/audit")).data;
    expect(global.map((e: Json) => e.action)).toContain("tenant.deleted");
  });
});

describe("readonly and hooks", () => {
  test("readonly blocks every mutating route with 403 READONLY, reads still work", async () => {
    const { call } = setup({ readonly: true });
    for (const [method, path, body] of [
      ["POST", "/api/tenants/acme/links", { url: "https://a.com" }],
      ["PUT", "/api/tenants/acme", {}],
      ["POST", "/api/domains", { hostname: "a.com" }],
      ["POST", "/api/tenants/acme/links/import", { rows: [] }],
      ["POST", "/api/track/lead", { customerId: "c" }],
    ] as const) {
      const res = await call(method, path, body);
      expect(res.status, path).toBe(403);
      expect(res.data.code).toBe("READONLY");
    }
    expect((await call("GET", "/api/tenants/acme/links")).status).toBe(200);
    expect((await call("GET", "/config")).data.readonly).toBe(true);
  });

  test("a readonly prebuilt core maps ReadonlyError to 403", async () => {
    const core = createLinksCore({
      storage: createMemoryStorage(),
      readonly: true,
      defaultDomain: "s.co",
    });
    const panel = createFetchHandler({ core });
    const res = await panel.fetch(
      new Request("http://x/api/tenants/a/links/lnk_1", {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(403);
  });

  test("a before-hook veto maps to its status", async () => {
    const { call } = setup({
      hooks: {
        before: (event) => {
          if (event.type === "link.create") {
            throw new HookDeniedError("quota exceeded", { status: 402 });
          }
        },
      },
    });
    const res = await call("POST", "/api/tenants/acme/links", { url: "https://a.com" });
    expect(res.status).toBe(402);
    expect(res.data).toMatchObject({ code: "HOOK_DENIED", error: "quota exceeded" });
  });

  test("an unexpected error is a 500", async () => {
    const core = createLinksCore({ storage: createMemoryStorage() });
    core.listTenants = async () => {
      throw new Error("db down");
    };
    const res = await createFetchHandler({ core }).fetch(new Request("http://x/api/tenants"));
    expect(res.status).toBe(500);
    expect(((await res.json()) as Json).error).toBe("db down");
  });
});

describe("cors", () => {
  test("answers preflight and decorates responses", async () => {
    const { panel } = setup({
      cors: { origin: ["https://app.example"], credentials: true, maxAge: 60 },
    });
    const pre = await panel.fetch(
      new Request("http://x/api/tenants", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example",
          "access-control-request-headers": "authorization",
        },
      }),
    );
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(pre.headers.get("access-control-allow-headers")).toBe("authorization");
    expect(pre.headers.get("access-control-max-age")).toBe("60");
    const res = await panel.fetch(
      new Request("http://x/api/tenants", { headers: { origin: "https://evil.example" } }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
