// Runs in the `elysia2` vitest project: `elysia` → the elysia-v2 devDep alias
// (see vite.config.ts + tsconfig.elysia2.json). Elysia 2's Eden is `@elysia/eden`.
import { describe, expect, test } from "vitest";
import { Elysia, t } from "elysia";
import { treaty } from "@elysia/eden";
import { linksElysia, linksPanel, linksRedirect } from "../src/adapters/elysia2.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";

const app = new Elysia().use(
  linksElysia({
    prefix: "/links",
    storage: createMemoryStorage(),
    defaultDomain: "sho.rt",
    title: "Eden v2",
  }),
);
const client = treaty<typeof app>(app);
const links = client.links!;
// Handlers delegate to a web Response, so Eden infers `data: Response`; cast via unknown.
const as = <T>(v: unknown): T => v as unknown as T;

describe("elysia 2 adapter", () => {
  test("runs against Elysia 2 (rejects the 1.x handler-then-hook order)", () => {
    const legacy = () =>
      // the 1.x order type-checks on v2, but Elysia 2 throws on it at registration
      new Elysia().post("/x", () => "x", { body: t.Object({ k: t.String() }) });
    expect(legacy).toThrow(/1\.x order/);
  });

  test("linksPanel mounts under a prefix", async () => {
    const panel = linksPanel({ storage: createMemoryStorage(), basePath: "/links" });
    const mounted = new Elysia().mount("/links", panel);
    const res = await mounted.handle(new Request("http://localhost/links/config"));
    expect(((await res.json()) as { basePath: string }).basePath).toBe("/links");
  });

  test("reads bootstrap config via client.links.config", async () => {
    const { data, error } = await links.config.get();
    expect(error).toBeNull();
    expect(as<{ title: string }>(data).title).toBe("Eden v2");
  });

  test("creates and lists links through the typed path", async () => {
    const acme = links.api.tenants({ tenant: "acme" });
    const created = await acme.links.post({ url: "https://example.com", slug: "v2" });
    expect(created.response.status).toBe(201);
    const list = await acme.links.get();
    expect(as<{ total: number }>(list.data).total).toBe(1);
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

  test("redirect plugin answers short links and falls through", async () => {
    const panel = linksPanel({ storage: createMemoryStorage(), defaultDomain: "sho.rt" });
    await panel.core.createLink({ url: "https://example.com/x", slug: "x" });
    const redirect = linksRedirect({ core: panel.core });
    const site = new Elysia().use(redirect).get("/about", () => "about");
    const hit = await site.handle(new Request("https://sho.rt/x"));
    expect(hit.status).toBe(302);
    expect(await (await site.handle(new Request("https://app.test/about"))).text()).toBe("about");
    await redirect.handler.close();
  });

  test("serves the bundled UI catch-all", async () => {
    const res = await app.handle(new Request("http://localhost/links/"));
    expect(res.status).toBeLessThan(500);
  });
});
