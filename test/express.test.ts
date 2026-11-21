import { afterAll, beforeAll, describe, expect, test } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { linksPanel, linksRedirect } from "../src/adapters/express.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";
import { USER_AGENTS } from "../src/testing.ts";

let server: Server;
let base: string;
let panel: ReturnType<typeof linksPanel>;
let redirect: ReturnType<typeof linksRedirect>;

beforeAll(async () => {
  const app = express();
  panel = linksPanel({
    basePath: "/links",
    storage: createMemoryStorage(),
    defaultDomain: "localhost",
  });
  await panel.core.createLink({ url: "https://example.com/hello", slug: "hello" });
  await panel.core.createLink({
    url: "https://example.com/secret",
    slug: "locked",
    password: "pw",
  });
  redirect = linksRedirect({ core: panel.core, resolver: { ttlMs: 0 } });
  app.use("/links", panel);
  app.use(redirect);
  // A body parser AFTER the redirect middleware must still see the raw body.
  app.post("/echo", express.json(), (req, res) => res.json(req.body));
  app.get("/", (_req, res) => res.send("app"));
  // A mount where an upstream body parser consumes the stream first.
  app.use(
    "/parsed",
    express.json(),
    linksPanel({ basePath: "/parsed", storage: createMemoryStorage() }),
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://localhost:${port}`;
});

afterAll(async () => {
  server?.close();
  await redirect?.handler.close();
});

describe("express panel", () => {
  test("serves bootstrap config under the mount path", async () => {
    const res = await fetch(`${base}/links/config`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { basePath: string }).basePath).toBe("/links");
  });

  test("handles a POST with a JSON body (raw stream)", async () => {
    const res = await fetch(`${base}/links/api/tenants/acme/links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://acme.com" }),
    });
    expect(res.status).toBe(201);
  });

  test("re-serializes a body already parsed by express.json()", async () => {
    const res = await fetch(`${base}/parsed/api/tenants/acme`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Acme" }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { name: string }).name).toBe("Acme");
  });

  test("serves the SPA fallback and attaches core + openapi", async () => {
    const res = await fetch(`${base}/links/anything`);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(panel.core).toBeDefined();
    expect(panel.openapi()).toMatchObject({ openapi: "3.1.0" });
  });
});

describe("express redirect middleware", () => {
  test("redirects short links", async () => {
    const res = await fetch(`${base}/hello`, {
      redirect: "manual",
      headers: { "user-agent": USER_AGENTS.macChrome },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/hello");
  });

  test("falls through to the app for its own routes and leaves bodies untouched", async () => {
    expect(await (await fetch(`${base}/`)).text()).toBe("app");
    const echo = await fetch(`${base}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hi: 1 }),
    });
    expect(await echo.json()).toEqual({ hi: 1 });
  });

  test("password form POST reads the body and sets the unlock cookie", async () => {
    const page = await fetch(`${base}/locked`, { redirect: "manual" });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Password required");
    const wrong = await fetch(`${base}/locked`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=nope",
    });
    expect(wrong.status).toBe(401);
    const ok = await fetch(`${base}/locked`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=pw",
    });
    expect(ok.status).toBe(303);
    const cookie = ok.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^xl_pw_/);
    const unlocked = await fetch(`${base}/locked`, {
      redirect: "manual",
      headers: { cookie: cookie.split(";")[0] as string },
    });
    expect(unlocked.status).toBe(302);
    expect(unlocked.headers.get("location")).toBe("https://example.com/secret");
  });
});
