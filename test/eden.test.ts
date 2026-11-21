import { describe, expect, test } from "vitest";
import { Elysia } from "elysia";
import { treaty } from "@elysiajs/eden";
import { linksElysia, linksRedirect } from "../src/adapters/elysia.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";

// Mounting the typed plugin under /links gives Eden's treaty a typed surface:
// client.links.api.tenants({ tenant: "acme" }).links.get(), etc.
const plugin = linksElysia({
  prefix: "/links",
  storage: createMemoryStorage(),
  defaultDomain: "sho.rt",
  title: "Eden Test",
});
const app = new Elysia().use(plugin);
const client = treaty<typeof app>(app);
// Eden types the prefix group as optional; bind it once for ergonomic access.
const links = client.links!;
// Handlers delegate to a web Response, so Eden infers `data: Response`; cast via unknown.
const as = <T>(v: unknown): T => v as unknown as T;

describe("eden typed client", () => {
  test("reads bootstrap config via client.links.config", async () => {
    const { data, error } = await links.config.get();
    expect(error).toBeNull();
    expect(as<{ basePath: string }>(data).basePath).toBe("/links");
    expect(as<{ title: string }>(data).title).toBe("Eden Test");
  });

  test("creates, lists, patches and deletes links through the typed path", async () => {
    const acme = links.api.tenants({ tenant: "acme" });
    const created = await acme.links.post({ url: "https://example.com", slug: "eden" });
    expect(created.response.status).toBe(201);
    const id = as<{ id: string }>(created.data).id;

    const list = await acme.links.get();
    expect(as<{ total: number }>(list.data).total).toBe(1);

    const patched = await acme.links({ id }).patch({ title: "Eden" });
    expect(as<{ title: string }>(patched.data).title).toBe("Eden");

    const qr = await acme.links({ id })["qr.svg"].get();
    expect(qr.response.headers.get("content-type")).toBe("image/svg+xml");

    expect((await acme.links({ id }).delete()).response.status).toBe(200);
  });

  test("tenants, domains, analytics and the OpenAPI document", async () => {
    expect(
      (await links.api.tenants({ tenant: "acme" }).put({ name: "Acme" })).response.status,
    ).toBe(200);
    expect((await links.api.domains.post({ hostname: "go.acme.com" })).response.status).toBe(201);
    const analytics = await links.api.tenants({ tenant: "acme" }).analytics.get();
    expect(as<{ totals: { clicks: number } }>(analytics.data).totals.clicks).toBe(0);
    const doc = await links.api["openapi.json"].get();
    expect(as<{ openapi: string }>(doc.data).openapi).toBe("3.1.0");
  });

  test("CSV import passes the raw body through", async () => {
    const res = await app.handle(
      new Request("http://localhost/links/api/tenants/acme/links/import?format=native", {
        method: "POST",
        headers: { "content-type": "text/csv" },
        body: "url,slug\nhttps://a.com,csv1\n",
      }),
    );
    expect(((await res.json()) as { created: number }).created).toBe(1);
  });

  test("validates declared bodies", async () => {
    const res = await app.handle(
      new Request("http://localhost/links/api/tenants/acme/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "no-url" }),
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  test("redirect plugin composes with the typed plugin", async () => {
    const both = new Elysia()
      .use(
        linksElysia({ prefix: "/admin", storage: createMemoryStorage(), defaultDomain: "sho.rt" }),
      )
      .get("/about", () => "about");
    const core = both.decorator.linksCore;
    await core.createLink({ url: "https://example.com/x", slug: "x" });
    both.use(linksRedirect({ core }));
    const hit = await both.handle(new Request("https://sho.rt/x"));
    expect(hit.status).toBe(302);
    expect(await (await both.handle(new Request("https://app.test/about"))).text()).toBe("about");
    expect((await both.handle(new Request("https://app.test/admin/config"))).status).toBe(200);
  });
});
