import { describe, expect, test } from "vitest";
import { basicAuth } from "../src/auth/basic.ts";
import { delegatedAuth } from "../src/auth/delegated.ts";
import { delegatedAuthorization } from "../src/authorization/delegated.ts";
import { rolesAuthorization } from "../src/authorization/roles.ts";
import { createViewerToken } from "../src/portal.ts";
import { createFetchHandler, type LinksPanelOptions } from "../src/server/create-fetch-handler.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";
import { createCollectingSink } from "../src/testing.ts";

type Json = Record<string, any>;
const SECRET = "viewer-secret";

function setup(options: Partial<LinksPanelOptions> = {}) {
  const panel = createFetchHandler({
    storage: createMemoryStorage(),
    analytics: createCollectingSink(),
    defaultDomain: "sho.rt",
    uiDir: "/nonexistent",
    ...options,
  });
  const call = async (
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: unknown,
  ) => {
    const res = await panel.fetch(
      new Request(`http://admin.test${path}`, {
        method,
        headers: {
          ...headers,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    );
    const type = res.headers.get("content-type") ?? "";
    return {
      status: res.status,
      res,
      data: (type.includes("json") ? await res.json() : await res.text()) as any,
    };
  };
  return { panel, core: panel.core, call };
}

const basic = (user: string, pass: string) => ({
  authorization: `Basic ${btoa(`${user}:${pass}`)}`,
});
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("basic auth + roles", () => {
  const options = (): Partial<LinksPanelOptions> => ({
    auth: basicAuth({
      users: [
        { username: "admin", password: "a", roles: ["admin"] },
        { username: "viewer", password: "v", roles: ["viewer"] },
      ],
    }),
    authorization: rolesAuthorization(),
  });

  test("401 with a challenge when unauthenticated; /config stays public", async () => {
    const { call } = setup(options());
    const res = await call("GET", "/api/tenants");
    expect(res.status).toBe(401);
    expect(res.res.headers.get("www-authenticate")).toContain("Basic");
    expect((await call("GET", "/api/tenants", basic("admin", "wrong"))).status).toBe(401);
    const config = await call("GET", "/config");
    expect(config.data).toMatchObject({ authenticated: false, principal: null });
  });

  test("admin can write; viewer role can read but not write", async () => {
    const { call } = setup(options());
    const created = await call("POST", "/api/tenants/acme/links", basic("admin", "a"), {
      url: "https://a.com",
    });
    expect(created.status).toBe(201);
    expect(created.data.createdBy).toBe("admin");
    expect((await call("GET", "/api/tenants/acme/links", basic("viewer", "v"))).data.total).toBe(1);
    const denied = await call("POST", "/api/tenants/acme/links", basic("viewer", "v"), {
      url: "https://b.com",
    });
    expect(denied.status).toBe(403);
    expect(denied.data.action).toBe("link:create");
    expect(
      (await call("POST", "/api/tenants/acme/viewer-tokens", basic("viewer", "v"), {})).status,
    ).toBe(403);
  });

  test("a throwing auth provider is a 500, not a 401", async () => {
    const { call } = setup({
      auth: delegatedAuth({
        authenticate: () => {
          throw new Error("idp down");
        },
      }),
    });
    expect((await call("GET", "/api/tenants")).status).toBe(500);
  });
});

describe("delegated per-tenant authorization", () => {
  const options = (): Partial<LinksPanelOptions> => ({
    auth: delegatedAuth({
      authenticate: (req) => {
        const t = req.headers.get("x-tenants");
        return t ? { id: "u", metadata: { tenants: t.split(",") } } : null;
      },
    }),
    authorization: delegatedAuthorization({
      authorize: ({ principal, resource }) =>
        resource.tenant === undefined ||
        ((principal?.metadata as { tenants?: string[] } | undefined)?.tenants ?? []).includes(
          resource.tenant,
        ),
    }),
  });

  test("resources carry the tenant; the tenant list is filtered per tenant", async () => {
    const { call, core } = setup(options());
    await core.upsertTenant({ key: "acme" });
    await core.upsertTenant({ key: "beta" });
    const mine = { "x-tenants": "acme" };
    expect((await call("GET", "/api/tenants", mine)).data.map((t: Json) => t.key)).toEqual([
      "acme",
    ]);
    expect((await call("GET", "/api/tenants/beta/links", mine)).status).toBe(403);
    expect((await call("GET", "/api/tenants/acme/links", mine)).status).toBe(200);
    expect((await call("GET", "/api/tenants", { "x-tenants": "zzz" })).status).toBe(403);
    // Moving a domain to a tenant you do not control is denied.
    await core.createDomain({ hostname: "go.acme.com", tenant: "acme" });
    expect((await call("PUT", "/api/domains/go.acme.com", mine, { tenant: "beta" })).status).toBe(
      403,
    );
    expect(
      (await call("PUT", "/api/domains/go.acme.com", mine, { rootUrl: "https://acme.com" })).status,
    ).toBe(200);
  });
});

describe("viewer tokens", () => {
  async function seeded(options: Partial<LinksPanelOptions> = {}) {
    const t = setup({
      portal: { secret: SECRET },
      auth: basicAuth({ users: [{ username: "admin", password: "a", roles: ["admin"] }] }),
      authorization: rolesAuthorization(),
      ...options,
    });
    const a = await t.core.createLink({
      tenant: "acme",
      url: "https://a.com",
      slug: "a",
      tags: ["x"],
    });
    const b = await t.core.createLink({
      tenant: "acme",
      url: "https://b.com",
      slug: "b",
      tags: ["y"],
    });
    const other = await t.core.createLink({ tenant: "beta", url: "https://c.com", slug: "c" });
    return { ...t, a, b, other };
  }

  test("/config reports the viewer scope", async () => {
    const { call, a } = await seeded();
    const token = await createViewerToken(SECRET, { tenant: "acme", links: [a.id] });
    const config = (await call("GET", "/config", bearer(token))).data;
    expect(config).toMatchObject({
      viewer: true,
      tenant: "acme",
      links: [a.id],
      allow: ["analytics:read", "link:read"],
      viewerTokens: true,
      principal: { id: "viewer:acme" },
    });
  });

  test("an invalid or expired token is a 401, never a fallback to host auth", async () => {
    const { call } = await seeded();
    const res = await call("GET", "/api/tenants/acme/links", bearer("lvt_bad.sig"));
    expect(res.status).toBe(401);
    expect(res.data.code).toBe("VIEWER_TOKEN");
    const expired = await createViewerToken(SECRET, { tenant: "acme", expiresIn: 0 });
    expect((await call("GET", "/config", bearer(expired))).status).toBe(401);
  });

  test("tenant-scoped: own tenant reads only, default actions only", async () => {
    const { call, a } = await seeded();
    const h = bearer(await createViewerToken(SECRET, { tenant: "acme" }));
    expect((await call("GET", "/api/tenants/acme/links", h)).data.total).toBe(2);
    expect((await call("GET", `/api/tenants/acme/links/${a.id}`, h)).status).toBe(200);
    expect((await call("GET", "/api/tenants/acme/analytics", h)).status).toBe(200);
    expect((await call("GET", "/api/tenants/beta/links", h)).status).toBe(403);
    expect((await call("GET", "/api/tenants/beta/analytics", h)).status).toBe(403);
    expect(
      (await call("POST", "/api/tenants/acme/links", h, { url: "https://z.com" })).status,
    ).toBe(403);
    expect((await call("GET", "/api/tenants/acme/customers", h)).status).toBe(403);
    expect((await call("GET", "/api/tenants", h)).status).toBe(403);
    expect((await call("GET", "/api/audit", h)).status).toBe(403);
    expect((await call("DELETE", "/api/tenants/acme", h)).status).toBe(403);
  });

  test("link-scoped: list, tags, get, analytics and events see only the token's links", async () => {
    const { call, a, b } = await seeded();
    const h = bearer(await createViewerToken(SECRET, { tenant: "acme", links: [a.id] }));
    const page = (await call("GET", "/api/tenants/acme/links?archived=all", h)).data;
    expect(page.total).toBe(1);
    expect(page.links.map((l: Json) => l.id)).toEqual([a.id]);
    expect((await call("GET", "/api/tenants/acme/links?search=b.com", h)).data.total).toBe(0);
    expect((await call("GET", "/api/tenants/acme/tags", h)).data).toEqual([{ tag: "x", count: 1 }]);
    expect((await call("GET", `/api/tenants/acme/links/${b.id}`, h)).status).toBe(403);
    expect((await call("GET", `/api/tenants/acme/links/${b.id}/qr.svg`, h)).status).toBe(403);
    expect((await call("GET", `/api/tenants/acme/analytics?linkIds=${b.id}`, h)).status).toBe(403);
    expect(
      (await call("GET", `/api/tenants/acme/analytics?linkIds=${a.id},${b.id}`, h)).status,
    ).toBe(200);
    expect((await call("GET", "/api/tenants/acme/analytics", h)).status).toBe(200);
    expect((await call("GET", "/api/tenants/acme/events", h)).status).toBe(200);
    const csv = (await call("GET", "/api/tenants/acme/links.csv", h)).data as string;
    expect(csv).toContain("https://sho.rt/a");
    expect(csv).not.toContain("https://sho.rt/b");
  });

  test("link-scoped analytics only counts the token's links", async () => {
    const sink = createCollectingSink();
    const { call, a, b } = await seeded({ analytics: sink });
    const at = new Date().toISOString();
    const click = (linkId: string, id: string) => ({
      type: "click" as const,
      id,
      at,
      tenant: "acme",
      linkId,
      domain: "sho.rt",
      slug: "x",
      destination: "https://a.com",
      device: "desktop" as const,
      os: "macos",
      browser: "chrome",
      referrerHost: "(direct)",
      bot: false,
      qr: false,
    });
    await sink.ingest([click(a.id, "clk_1"), click(b.id, "clk_2"), click(b.id, "clk_3")]);
    const h = bearer(await createViewerToken(SECRET, { tenant: "acme", links: [a.id] }));
    expect((await call("GET", "/api/tenants/acme/analytics", h)).data.totals.clicks).toBe(1);
    const events = (await call("GET", "/api/tenants/acme/events", h)).data;
    expect(events.map((e: Json) => e.id)).toEqual(["clk_1"]);
    const admin = basic("admin", "a");
    expect((await call("GET", "/api/tenants/acme/analytics", admin)).data.totals.clicks).toBe(3);
  });

  test("token allow widens to link management, but never beyond the tenant / link set", async () => {
    const { call, a, b } = await seeded();
    const manage = bearer(
      await createViewerToken(SECRET, {
        tenant: "acme",
        allow: ["link:read", "link:create", "link:update", "tenant:delete" as never],
      }),
    );
    expect(
      (await call("POST", "/api/tenants/acme/links", manage, { url: "https://n.com" })).status,
    ).toBe(201);
    expect(
      (await call("PATCH", `/api/tenants/acme/links/${a.id}`, manage, { title: "A" })).status,
    ).toBe(200);
    expect((await call("DELETE", `/api/tenants/acme/links/${a.id}`, manage)).status).toBe(403);
    expect((await call("DELETE", "/api/tenants/acme", manage)).status).toBe(403); // never grantable
    expect((await call("GET", "/api/tenants/acme/analytics", manage)).status).toBe(403);

    const scoped = bearer(
      await createViewerToken(SECRET, {
        tenant: "acme",
        links: [a.id],
        allow: ["link:read", "link:create", "link:update", "link:import"],
      }),
    );
    expect(
      (await call("POST", "/api/tenants/acme/links", scoped, { url: "https://n.com" })).status,
    ).toBe(403);
    expect(
      (await call("POST", "/api/tenants/acme/links/import", scoped, { rows: [] })).status,
    ).toBe(403);
    expect(
      (await call("PATCH", `/api/tenants/acme/links/${b.id}`, scoped, { title: "B" })).status,
    ).toBe(403);
    expect(
      (await call("PATCH", `/api/tenants/acme/links/${a.id}`, scoped, { title: "A2" })).status,
    ).toBe(200);
  });

  test("panel portal.allow sets the default grant; domains are readable when granted", async () => {
    const { call, core } = await seeded({
      portal: { secret: SECRET, allow: ["domain:read", "tenant:read", "conversion:track"] },
    });
    await core.createDomain({ hostname: "go.beta.com", tenant: "beta" });
    await core.createDomain({ hostname: "go.acme.com", tenant: "acme" });
    const h = bearer(await createViewerToken(SECRET, { tenant: "acme" }));
    const domains = (await call("GET", "/api/domains?tenant=beta", h)).data.map(
      (d: Json) => d.hostname,
    );
    expect(domains).toEqual(["go.acme.com", "sho.rt"]);
    expect((await call("GET", "/api/domains/go.beta.com", h)).status).toBe(403);
    expect((await call("GET", "/api/domains/sho.rt", h)).status).toBe(200);
    expect((await call("DELETE", "/api/domains/go.acme.com", h)).status).toBe(403);
    expect((await call("GET", "/api/tenants", h)).data.map((t: Json) => t.key)).toEqual(["acme"]);
    expect((await call("GET", "/api/tenants/acme/links", h)).status).toBe(403);
    // conversion:track is confined to the viewer's tenant (tenant defaults to it).
    const lead = await call("POST", "/api/track/lead", h, { customerId: "c1", clickId: "clk_x" });
    expect(lead.data).toEqual({ attributed: false });
    expect(
      (await call("POST", "/api/track/lead", h, { tenant: "beta", customerId: "c1" })).status,
    ).toBe(403);
  });

  test("host authorization is not consulted for viewers", async () => {
    let consulted = 0;
    const { call } = await seeded({
      authorization: delegatedAuthorization({
        authorize: () => {
          consulted++;
          return false;
        },
      }),
    });
    const h = bearer(await createViewerToken(SECRET, { tenant: "acme" }));
    expect((await call("GET", "/api/tenants/acme/links", h)).status).toBe(200);
    expect(consulted).toBe(0);
  });

  test("viewer tokens are ignored (host auth applies) when the panel has no portal", async () => {
    const t = setup({ auth: basicAuth({ users: [{ username: "admin", password: "a" }] }) });
    const token = await createViewerToken(SECRET, { tenant: "acme" });
    expect((await t.call("GET", "/api/tenants/acme/links", bearer(token))).status).toBe(401);
  });

  test("minting via the API: scoped, delegation-checked, validated", async () => {
    const { call, a } = await seeded();
    const admin = basic("admin", "a");
    const minted = await call("POST", "/api/tenants/acme/viewer-tokens", admin, {
      links: [a.id],
      expiresIn: "1h",
    });
    expect(minted.status).toBe(201);
    expect(minted.data).toMatchObject({
      tenant: "acme",
      links: [a.id],
      allow: ["analytics:read", "link:read"],
    });
    expect(Date.parse(minted.data.expiresAt) - Date.now()).toBeLessThanOrEqual(3_600_000);
    const page = (await call("GET", "/api/tenants/acme/links", bearer(minted.data.token))).data;
    expect(page.links.map((l: Json) => l.id)).toEqual([a.id]);

    const bad = await call("POST", "/api/tenants/acme/viewer-tokens", admin, {
      allow: ["tenant:delete"],
      expiresIn: "soon",
      links: "x",
    });
    expect(bad.status).toBe(400);
    expect(bad.data.errors.map((e: Json) => e.path).sort()).toEqual([
      "allow",
      "expiresIn",
      "links",
    ]);

    // A minter can only delegate what it holds.
    const limited = setup({
      portal: { secret: SECRET },
      auth: basicAuth({ users: [{ username: "m", password: "m", roles: ["minter"] }] }),
      authorization: rolesAuthorization({
        policy: { minter: ["viewer-token:create", "link:read"] },
      }),
    });
    const denied = await limited.call(
      "POST",
      "/api/tenants/acme/viewer-tokens",
      basic("m", "m"),
      {},
    );
    expect(denied.status).toBe(403);
    expect(denied.data.action).toBe("analytics:read");
    const ok = await limited.call("POST", "/api/tenants/acme/viewer-tokens", basic("m", "m"), {
      allow: ["link:read"],
    });
    expect(ok.status).toBe(201);
  });

  test("minting without a configured secret is a 501", async () => {
    const { call } = setup();
    const res = await call("POST", "/api/tenants/acme/viewer-tokens", {}, {});
    expect(res.status).toBe(501);
    expect(res.data.code).toBe("NOT_CONFIGURED");
  });
});
