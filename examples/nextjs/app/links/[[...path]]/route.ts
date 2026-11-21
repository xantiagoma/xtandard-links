/**
 * The admin panel — UI, JSON API and OpenAPI — on an optional catch-all route,
 * so `/links`, `/links/api/…` and the SPA's client-side routes all land here.
 */
import { linksRouteHandlers } from "@xtandard/links/next";
import { defaultDomain, storage } from "../../../lib/links";

const panel = linksRouteHandlers({
  storage,
  basePath: "/links",
  title: "Acme Links",
  defaultDomain,
});

export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = panel;

// Every request reads live data.
export const dynamic = "force-dynamic";
