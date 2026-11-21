/**
 * Framework-agnostic helpers shared by every adapter's `linksRedirect`.
 * Must not import any framework.
 *
 * @module
 */

import {
  createRedirectHandler,
  type RedirectHandler,
  type RedirectHandlerOptions,
} from "../redirect.ts";

/** Options or a prebuilt handler (share one with other mounts). */
export type LinksRedirectInput = RedirectHandlerOptions | RedirectHandler;

/** A prebuilt redirect handler as-is, or a new one from options. */
export function toRedirectHandler(input: LinksRedirectInput): RedirectHandler {
  return "handle" in input && "resolver" in input && typeof input.handle === "function"
    ? input
    : createRedirectHandler(input as RedirectHandlerOptions);
}
