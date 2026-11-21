import { describe, expect, test } from "vitest";
import { linksPanel as bunPanel, linksRedirect as bunRedirect } from "../src/adapters/bun.ts";
import {
  linksPanel as elysiaPanel,
  linksRedirect as elysiaRedirect,
} from "../src/adapters/elysia.ts";
import { linksPanel as honoPanel, linksRedirect as honoRedirect } from "../src/adapters/hono.ts";
import {
  linksMiddleware,
  linksPanel as nextPanel,
  linksRedirect as nextRedirect,
  linksRouteHandlers,
} from "../src/adapters/next.ts";
import { createRedirectHandler } from "../src/redirect.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";
import { clickRequest } from "../src/testing.ts";

/** A panel + a short link `sho.rt/hello` → https://example.com/hello. */
async function seeded() {
  const panel = bunPanel({
    storage: createMemoryStorage(),
    defaultDomain: "sho.rt",
    basePath: "/links",
  });
  await panel.core.createLink({ url: "https://example.com/hello", slug: "hello" });
  return panel;
}

describe("bun adapter", () => {
  test("linksPanel returns fetch + core + openapi", async () => {
    const panel = bunPanel({ storage: createMemoryStorage() });
    expect(panel.core).toBeDefined();
    expect(panel.openapi()).toMatchObject({ openapi: "3.1.0" });
    expect((await panel.fetch(new Request("http://x/config"))).status).toBe(200);
  });

  test("linksRedirect answers short links and falls through to `fallback`", async () => {
    const panel = await seeded();
    const redirects = bunRedirect({ core: panel.core, fallback: panel.fetch });
    const hit = await redirects.fetch(clickRequest("https://sho.rt/hello"));
    expect(hit.status).toBe(302);
    expect(hit.headers.get("location")).toBe("https://example.com/hello");
    // Not a short-link host → the fallback (here: the panel).
    const panelHit = await redirects.fetch(new Request("https://admin.test/links/config"));
    expect(((await panelHit.json()) as { basePath: string }).basePath).toBe("/links");
    expect(await redirects.handle(new Request("https://other.host/x"))).toBeNull();
    await redirects.handler.close();
  });

  test("without a fallback, misses get the 404 page; accepts a prebuilt handler", async () => {
    const panel = await seeded();
    const handler = createRedirectHandler({ core: panel.core });
    const redirects = bunRedirect(handler);
    expect(redirects.handler).toBe(handler);
    expect((await redirects.fetch(new Request("https://other.host/x"))).status).toBe(404);
    await handler.close();
  });
});

describe("hono adapter", () => {
  test("panel mounts under a route prefix and serves the JSON API", async () => {
    const { Hono } = await import("hono");
    const app = new Hono();
    const panel = honoPanel({
      storage: createMemoryStorage(),
      basePath: "/links",
      defaultDomain: "sho.rt",
    });
    app.route("/links", panel);
    const create = await app.request("/links/api/tenants/acme/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", slug: "x" }),
    });
    expect(create.status).toBe(201);
    expect((await panel.core.listLinks("acme")).total).toBe(1);
    expect(panel.openapi()).toMatchObject({ openapi: "3.1.0" });
  });

  test("redirect middleware answers short links and calls next() otherwise", async () => {
    const { Hono } = await import("hono");
    const panel = await seeded();
    const app = new Hono();
    const middleware = honoRedirect({ core: panel.core });
    app.use(middleware);
    app.get("/about", (c) => c.text("about"));
    const hit = await app.request(clickRequest("https://sho.rt/hello"));
    expect(hit.status).toBe(302);
    // Unknown slug on a registered short domain without notFoundUrl: falls through to the host.
    expect(await (await app.request("https://sho.rt/about")).text()).toBe("about");
    const own = await app.request("https://app.test/about");
    expect(await own.text()).toBe("about");
    await middleware.handler.close();
  });

  test("passes executionCtx.waitUntil when the runtime has one", async () => {
    const { Hono } = await import("hono");
    const panel = await seeded();
    const app = new Hono();
    app.use(honoRedirect({ core: panel.core }));
    const waited: Promise<unknown>[] = [];
    const res = await app.fetch(clickRequest("https://sho.rt/hello"), {}, {
      waitUntil: (p: Promise<unknown>) => void waited.push(p),
      passThroughOnException: () => {},
      props: {},
    } as never);
    expect(res.status).toBe(302);
    expect(waited.length).toBeGreaterThan(0);
    await Promise.all(waited);
  });
});

describe("next adapter", () => {
  test("route handlers serve the panel for every method", async () => {
    const handlers = linksRouteHandlers({
      storage: createMemoryStorage(),
      basePath: "/links",
      defaultDomain: "sho.rt",
    });
    const created = await handlers.POST(
      new Request("http://app.test/links/api/tenants/acme/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      }),
    );
    expect(created.status).toBe(201);
    const list = await handlers.GET(new Request("http://app.test/links/api/tenants/acme/links"));
    expect(((await list.json()) as { total: number }).total).toBe(1);
    expect(
      (
        await handlers.OPTIONS(
          new Request("http://app.test/links/api/tenants", { method: "OPTIONS" }),
        )
      ).status,
    ).toBe(405);
    expect(handlers.core).toBeDefined();
    expect(nextPanel({ storage: createMemoryStorage() }).openapi()).toMatchObject({
      openapi: "3.1.0",
    });
  });

  test("middleware resolves a Response for short links, undefined to continue", async () => {
    const panel = await seeded();
    const middleware = linksMiddleware({ core: panel.core });
    expect(nextRedirect).toBe(linksMiddleware);
    const waited: Promise<unknown>[] = [];
    const event = { waitUntil: (p: Promise<unknown>) => void waited.push(p) };
    const hit = await middleware(clickRequest("https://sho.rt/hello"), event);
    expect(hit?.status).toBe(302);
    expect(waited.length).toBeGreaterThan(0);
    expect(await middleware(new Request("https://app.test/dashboard"))).toBeUndefined();
    await Promise.all(waited);
    await middleware.handler.close();
  });
});

describe("elysia adapter", () => {
  test("linksPanel is a request→response function with extras attached", async () => {
    const handler = elysiaPanel({ storage: createMemoryStorage(), basePath: "/links" });
    expect(typeof handler).toBe("function");
    expect(handler.core).toBeDefined();
    expect(typeof handler.openapi).toBe("function");
    const res = await handler(new Request("http://x/links/config"));
    expect(((await res.json()) as { basePath: string }).basePath).toBe("/links");
  });

  test("linksRedirect answers short links before routing and falls through otherwise", async () => {
    const { Elysia } = await import("elysia");
    const panel = await seeded();
    const redirect = elysiaRedirect({ core: panel.core });
    const app = new Elysia().use(redirect).get("/about", () => "about");
    const hit = await app.handle(clickRequest("https://sho.rt/hello"));
    expect(hit.status).toBe(302);
    expect(hit.headers.get("location")).toBe("https://example.com/hello");
    expect(await (await app.handle(new Request("https://app.test/about"))).text()).toBe("about");
    await redirect.handler.close();
  });
});
