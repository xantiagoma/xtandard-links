/**
 * An Eden treaty client for the running example — every call below is typed
 * from `App` (paths, params, bodies), with no codegen.
 *
 *   bun run src/index.ts &      # start the server first
 *   bun run src/demo.ts         # BASE_URL defaults to http://localhost:3000
 */
import { treaty } from "@elysiajs/eden";
import type { App } from "./index.ts";

const baseUrl = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const client = treaty<App>(baseUrl);
// Eden types a prefix group as optional; bind it once.
const tenant = client.links!.api.tenants({ tenant: "default" });

// The admin routes declare params and bodies, but their handlers return the
// panel's web `Response`, so Eden infers `data` loosely — narrow it yourself.
const as = <T>(value: unknown): T => value as T;

// Create a link — the body is checked against the plugin's schema.
const created = await tenant.links.post({
  url: "https://elysiajs.com",
  title: "Elysia",
  tags: ["eden-demo"],
});
if (created.error)
  throw new Error(`create failed: ${created.status} ${JSON.stringify(created.error.value)}`);
const link = as<{ id: string; slug: string; domain: string }>(created.data);
console.log(`created  ${link.domain}/${link.slug} (${link.id})`);

// Click it (a plain fetch — redirects are not part of the admin API).
const click = await fetch(`${baseUrl}/${link.slug}`, { redirect: "manual" });
console.log(`clicked  /${link.slug} → ${click.status} ${click.headers.get("location")}`);

// List the tenant's links.
const list = await tenant.links.get();
const links = as<{ links: { slug: string }[] } | null>(list.data)?.links ?? [];
console.log(`links    ${links.map((l) => l.slug).join(", ")}`);

// Tidy up.
const removed = await tenant.links({ id: link.id }).delete();
console.log(`deleted  ${link.id} → ${removed.status}`);
