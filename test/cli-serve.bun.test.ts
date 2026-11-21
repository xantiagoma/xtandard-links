/**
 * Integration test for the CLI `serve` command: boots in a subprocess (so the
 * never-resolving `run(["serve"])` doesn't hang the test), then probes the
 * healthcheck, basic-auth enforcement on the panel, and a redirect on the same
 * port. Spawned via Bun, so it runs under `bun test` (not vitest).
 *
 *   bun test test/cli-serve.bun.test.ts
 */
import { afterAll, expect, test } from "bun:test";

const PORT = 4513;
const BASE = `http://localhost:${PORT}`;
const auth = { authorization: `Basic ${btoa("admin:secret")}` };

const proc = Bun.spawn(["bun", "-e", "import('./src/cli.ts').then((m) => m.run(['serve']))"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(PORT),
    AUTH_MODE: "basic",
    AUTH_USERNAME: "admin",
    AUTH_PASSWORD: "secret",
    STORAGE_DRIVER: "memory",
    VIEWER_SECRET: "s3cret",
  },
  stdout: "pipe",
  stderr: "pipe",
});

// Empty AUTH_MODE means the default `none` (not an unknown mode).
const OPEN_PORT = 4514;
const openProc = Bun.spawn(["bun", "-e", "import('./src/cli.ts').then((m) => m.run(['serve']))"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(OPEN_PORT), AUTH_MODE: "", STORAGE_DRIVER: "memory" },
  stdout: "pipe",
  stderr: "pipe",
});

afterAll(() => {
  proc.kill();
  openProc.kill();
});

async function waitForServer(url: string, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await Bun.sleep(250);
  }
  throw new Error(`${url} did not become ready in time`);
}

test("serve boots the panel (basic auth) and the redirect handler on one port", async () => {
  await waitForServer(`${BASE}/healthcheck`);
  expect(((await (await fetch(`${BASE}/healthcheck`)).json()) as { status: string }).status).toBe(
    "ok",
  );

  // Bootstrap config is public; the admin API needs credentials.
  const config = (await (await fetch(`${BASE}/links/config`)).json()) as { viewerTokens: boolean };
  expect(config.viewerTokens).toBe(true);
  expect((await fetch(`${BASE}/links/api/tenants`)).status).toBe(401);
  expect((await fetch(`${BASE}/links/api/tenants`, { headers: auth })).status).toBe(200);

  // Create a link on the default domain (localhost) and follow it.
  const created = await fetch(`${BASE}/links/api/tenants/default/links`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/served", slug: "served" }),
  });
  expect(created.status).toBe(201);
  const hit = await fetch(`${BASE}/served`, { redirect: "manual" });
  expect(hit.status).toBe(302);
  expect(hit.headers.get("location")).toBe("https://example.com/served");
  expect((await fetch(`${BASE}/nope`, { redirect: "manual" })).status).toBe(404);
  const root = await fetch(`${BASE}/`, { redirect: "manual" });
  expect(root.headers.get("location")).toBe("/links/");
});

test("serve exits non-zero on an unknown AUTH_MODE instead of serving an open panel", async () => {
  const unknown = Bun.spawn(
    [
      "bun",
      "-e",
      "import('./src/cli.ts').then((m) => m.run(['serve'])).then((code) => process.exit(code))",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(OPEN_PORT + 1),
        AUTH_MODE: "basci",
        STORAGE_DRIVER: "memory",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const timeout = setTimeout(() => unknown.kill(), 20_000);
  const code = await unknown.exited;
  clearTimeout(timeout);
  expect(code).not.toBe(0);
  expect(await new Response(unknown.stderr).text()).toContain(
    'Unknown AUTH_MODE "basci" (expected none or basic)',
  );
  expect(await new Response(unknown.stdout).text()).not.toContain("listening");
});

test("serve with an empty AUTH_MODE defaults to none", async () => {
  const base = `http://localhost:${OPEN_PORT}`;
  await waitForServer(`${base}/healthcheck`);
  expect((await fetch(`${base}/links/api/tenants`)).status).toBe(200);
});
