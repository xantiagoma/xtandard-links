/**
 * Run a bundled example with a free port (no collisions if you run several).
 *
 *   bun run examples:hono        # or: elysia | express | bun | conversions | …
 *   bun scripts/example.ts <name>
 *
 * Server examples get a free PORT picked via get-port-please; script examples
 * (no server) just run. Each example is installed (`bun install`) on first use.
 * Examples link the package via `file:../..`, so build the repo once first:
 * `bun run build`.
 *
 * Not runnable here: `nextjs` (`bun install && bun run dev` in its folder) and
 * `cloudflare-workers` (`bunx wrangler dev`).
 *
 * @module
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { getPort } from "get-port-please";

interface ExampleConfig {
  dir: string;
  kind: "server" | "script";
  /** Command to run (in the example dir). */
  run: string[];
  /** Preferred port for server examples; a nearby free one is used if taken. */
  preferredPort?: number;
  /** Path to print after the URL (the panel, usually). */
  path?: string;
  /** External requirement or hint to surface before running. */
  note?: string;
}

const EXAMPLES: Record<string, ExampleConfig> = {
  hono: {
    dir: "examples/hono",
    kind: "server",
    run: ["bun", "run", "start"],
    preferredPort: 3000,
    path: "/links",
    note: "panel at /links, short links at /docs and /gh (SQLite: ./links.db)",
  },
  elysia: {
    dir: "examples/elysia",
    kind: "server",
    run: ["bun", "run", "start"],
    preferredPort: 3000,
    path: "/links",
    note: "typed admin plugin — run `bun run demo` in examples/elysia (PORT=…) for the Eden client",
  },
  express: {
    dir: "examples/express",
    kind: "server",
    run: ["bun", "run", "start"],
    preferredPort: 3000,
    path: "/links",
  },
  bun: {
    dir: "examples/bun",
    kind: "server",
    run: ["bun", "run", "start"],
    preferredPort: 3000,
    path: "/links",
  },
  conversions: {
    dir: "examples/conversions",
    kind: "script",
    run: ["bun", "run", "start"],
    note: "click → lead → sale attribution, then analytics",
  },
  "deep-links": {
    dir: "examples/deep-links",
    kind: "script",
    run: ["bun", "run", "start"],
    note: "association files, store fallbacks and the deferred-claim round trip",
  },
  "storage-drivers": {
    dir: "examples/storage-drivers",
    kind: "script",
    run: ["bun", "run", "start"],
    note: "memory + file + sqlite always run; set REDIS_URL / DATABASE_URL / MONGO_URL / LIBSQL_URL for more",
  },
  "webhooks-bridge": {
    dir: "examples/webhooks-bridge",
    kind: "script",
    run: ["bun", "run", "start"],
    note: "bridges/webhooks + bridges/audit with printing fakes",
  },
  "react-embed": {
    dir: "examples/react-embed",
    kind: "server",
    run: ["bun", "run", "start"],
    preferredPort: 5191,
    note: "<LinksDashboard> + <LinkAnalytics> in a vite host app — boots a seeded panel on :3702",
  },
};

const name = process.argv[2];
const cfg = name ? EXAMPLES[name] : undefined;
if (!cfg) {
  console.error(`Unknown example "${name ?? ""}". Available: ${Object.keys(EXAMPLES).join(", ")}`);
  process.exit(1);
}

if (!existsSync("dist")) {
  console.error("dist/ is missing — build the package first: bun run build");
  process.exit(1);
}

async function sh(cmd: string[], cwd: string, env?: Record<string, string>): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  const cleanup = () => proc.kill();
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  return proc.exited;
}

if (cfg.note) console.log(`i  ${name}: ${cfg.note}`);

// Install on first use (examples link the package via file:../..).
if (!existsSync(join(cfg.dir, "node_modules"))) {
  console.log(`Installing ${name} dependencies …`);
  const code = await sh(["bun", "install"], cfg.dir);
  if (code !== 0) process.exit(code);
}

const env: Record<string, string> = {};
if (cfg.kind === "server") {
  const preferred = cfg.preferredPort ?? 3000;
  const port = await getPort({ port: preferred, portRange: [preferred, preferred + 200] });
  env.PORT = String(port);
  console.log(`>  ${name} → http://localhost:${port}${cfg.path ?? ""}`);
}

process.exit(await sh(cfg.run, cfg.dir, env));
