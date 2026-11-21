/**
 * Standalone `@xtandard/links` server — what the Docker image runs.
 *
 * Delegates to the CLI's `serve` command (admin panel at BASE_PATH, default
 * `/links`, plus the redirect handler on every other path, all configured via
 * environment variables, `/healthcheck` included), overriding only the storage
 * default: containers default to `memory` (ephemeral demo mode) where the bare
 * CLI defaults to `file`.
 */

// In-repo app: imports the library from source (Bun runs TS directly), so the
// Docker image needs no compiled lib — only the UI bundle (dist/ui). Published
// consumers import from "@xtandard/links/*"; see examples/ for that usage.
process.env.STORAGE_DRIVER ??= "memory";

const { run } = await import("../../../src/cli.ts");

run(["serve"]).then(
  (code) => process.exit(code),
  (err) => {
    console.error("[xtandard/links] failed to start:", err);
    process.exit(1);
  },
);
