/**
 * Shared configuration for the panel (app/links/[[...path]]/route.ts) and the
 * redirect plane (middleware.ts). Next builds them as separate bundles, so each
 * creates its own core over the SAME storage; link edits made in the panel reach
 * the middleware's cache through the storage's change notifications (file
 * storage watches the directory) or its TTL.
 *
 * File storage keeps the example dependency-free. In production use a shared
 * database: `storage/postgres`, `storage/redis`, or `storage/unstorage` with
 * Upstash / Vercel KV (which also lets the middleware run on the Edge runtime).
 */
import { createFileStorage } from "@xtandard/links/storage/file";

export const storage = createFileStorage({ dir: process.env.LINKS_DIR ?? "./.links" });

/** The host short links are served on. In production: your branded domain. */
export const defaultDomain = process.env.LINKS_DOMAIN ?? "localhost";
