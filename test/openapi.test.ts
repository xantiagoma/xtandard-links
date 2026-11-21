import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { buildOpenApiDocument } from "../src/server/openapi.ts";

/** Every `pattern: "…"` declared in the router, as OpenAPI paths. */
function routerPaths(): { method: string; path: string }[] {
  const source = readFileSync(new URL("../src/server/routes.ts", import.meta.url), "utf8");
  const routes = [...source.matchAll(/method: "(\w+)",\s*pattern: "([^"]+)"/g)];
  return routes.map((m) => ({
    method: (m[1] as string).toLowerCase(),
    path: (m[2] as string).replace(/:(\w+)/g, "{$1}"),
  }));
}

describe("openapi document", () => {
  const doc = buildOpenApiDocument({ basePath: "/links", title: "T" }) as any;

  test("is OpenAPI 3.1 with servers, security schemes and info", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.servers).toEqual([{ url: "/links" }]);
    expect(doc.info.title).toBe("T");
    expect(Object.keys(doc.components.securitySchemes)).toEqual(["basicAuth", "bearerAuth"]);
    expect(buildOpenApiDocument().servers).toEqual([{ url: "/" }]);
  });

  test("documents every router route (method + path)", () => {
    const routes = routerPaths();
    expect(routes.length).toBeGreaterThan(25);
    for (const { method, path } of routes) {
      expect(doc.paths[path]?.[method], `${method.toUpperCase()} ${path}`).toBeDefined();
    }
  });

  test("every $ref resolves", () => {
    const refs = JSON.stringify(doc).match(/#\/components\/schemas\/\w+/g) ?? [];
    for (const ref of new Set(refs)) {
      expect(doc.components.schemas[ref.split("/").pop() as string], ref).toBeDefined();
    }
  });
});
