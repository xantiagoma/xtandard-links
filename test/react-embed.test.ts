import { describe, expect, it } from "vitest";
import {
  LinkAnalytics,
  LinksDashboard,
  setApiBase,
  setApiToken,
  type LinkAnalyticsProps,
  type LinksDashboardProps,
} from "../src/react.tsx";

// Smoke test for the `@xtandard/links/react` embed entry: the module must
// import cleanly outside a DOM and export both components. No rendering here —
// everything visual is covered by e2e (e2e/embed.spec.ts).
describe("react embed", () => {
  it("exports LinksDashboard and LinkAnalytics as components", () => {
    expect(typeof LinksDashboard).toBe("function");
    expect(typeof LinkAnalytics).toBe("function");
  });

  it("exports the API client setters", () => {
    expect(typeof setApiBase).toBe("function");
    expect(typeof setApiToken).toBe("function");
  });

  it("prop types compile", () => {
    const dashboardProps: LinksDashboardProps = {
      apiBaseUrl: "/links",
      credentials: "include",
      fetch: (input, init) => fetch(input, init),
      theme: "inherit",
      className: "embedded",
      routing: "memory",
      routerBase: "/admin/links",
      logoUrl: "/logo.svg",
      initialTenant: "acme",
    };

    const widgetProps: LinkAnalyticsProps = {
      apiBaseUrl: "/links",
      token: "lvt_example",
      theme: "dark",
    };

    const invalidWidgetProps: LinkAnalyticsProps = {
      token: "lvt_example",
      // @ts-expect-error — the widget is pinned to the token's tenant.
      initialTenant: "acme",
    };

    const minimalDashboardProps: LinksDashboardProps = {};

    expect(dashboardProps.apiBaseUrl).toBe("/links");
    expect(widgetProps.token).toBe("lvt_example");
    expect(invalidWidgetProps.token).toBe("lvt_example");
    expect(minimalDashboardProps).toEqual({});
  });
});
