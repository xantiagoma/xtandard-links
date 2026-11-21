import { afterEach, describe, expect, test } from "vitest";
import { auditBridge } from "../src/bridges/audit.ts";
import { webhooksBridge } from "../src/bridges/webhooks.ts";
import { captureClickId, clearClickId, getClickId } from "../src/client.ts";
import { clickRequest, createTestLinks } from "../src/testing.ts";

const CLICK = "clk_01JDB6Z0000000000000000000";

function fakeBrowser(href: string) {
  let cookies: string[] = [];
  const g = globalThis as Record<string, unknown>;
  const history = {
    state: null,
    replaceState: (_s: unknown, _t: string, url: string) => (location.href = url),
  };
  const location = { href, protocol: new URL(href).protocol };
  g.window = { location, history };
  g.document = {
    get cookie() {
      return cookies.join("; ");
    },
    set cookie(v: string) {
      const [pair] = v.split(";");
      const [name] = (pair ?? "").split("=");
      cookies = cookies.filter((c) => !c.startsWith(`${name}=`));
      if (!/Max-Age=0/.test(v)) cookies.push(pair ?? "");
    },
  };
  return location;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).document;
});

describe("client", () => {
  test("captures the click id into a cookie and cleans the URL", () => {
    const location = fakeBrowser(`https://shop.example/?a=1&xl_id=${CLICK}`);
    expect(captureClickId()).toBe(CLICK);
    expect(location.href).toBe("https://shop.example/?a=1");
    expect(getClickId()).toBe(CLICK);
    expect(captureClickId()).toBe(CLICK); // from cookie
    clearClickId();
    expect(getClickId()).toBeUndefined();
  });

  test("ignores malformed ids and works without a DOM", () => {
    fakeBrowser("https://shop.example/?xl_id=evil");
    expect(captureClickId()).toBeUndefined();
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).document;
    expect(captureClickId()).toBeUndefined();
    expect(getClickId()).toBeUndefined();
  });
});

describe("bridges", () => {
  test("webhooks bridge publishes lifecycle, conversion and (opt-in) click events", async () => {
    const published: { app: string; type: string }[] = [];
    const bridge = webhooksBridge({
      webhooks: {
        publish: async (app, input) => void published.push({ app, type: input.eventType }),
      },
      clicks: true,
      prefix: "links.",
    });
    const { core, redirects, flush } = createTestLinks({
      hooks: bridge.hooks,
      redirect: { onClick: bridge.onClick },
    });
    const link = await core.createLink({
      tenant: "acme",
      url: "https://example.com",
      slug: "w",
      trackConversions: true,
    });
    const res = await redirects.fetch(clickRequest("https://sho.rt/w"));
    await flush();
    const clickId = new URL(res.headers.get("location") ?? "").searchParams.get("xl_id") ?? "";
    await core.trackLead({ tenant: "acme", clickId, customerId: "c1" });
    await core.deleteLink("acme", link.id);
    await new Promise((r) => setTimeout(r, 0));
    expect(published.map((p) => p.type)).toEqual([
      "links.link.created",
      "links.link.clicked",
      "links.lead.created",
      "links.link.deleted",
    ]);
    expect(published.every((p) => p.app === "acme")).toBe(true);
    expect(bridge.eventTypes).toContain("links.link.clicked");
  });

  test("webhooks bridge reports publish errors and respects application mapping", async () => {
    const errors: unknown[] = [];
    const bridge = webhooksBridge({
      webhooks: {
        publish: async () => {
          throw new Error("no app");
        },
      },
      application: (t) => (t === "skip" ? null : t),
      onError: (e) => errors.push(e),
    });
    const { core } = createTestLinks({ hooks: bridge.hooks });
    await core.createLink({ tenant: "skip", url: "https://example.com" });
    await core.createLink({ tenant: "acme", url: "https://example.com" });
    expect(errors).toHaveLength(1);
  });

  test("audit bridge records actions with actors, targets and changed fields", async () => {
    const recorded: {
      tenant: string;
      action: string;
      actor?: { id: string };
      metadata?: Record<string, unknown>;
    }[] = [];
    const { core } = createTestLinks({
      hooks: auditBridge({ audit: { record: async (e) => void recorded.push(e) } }),
    });
    await core.createDomain({ hostname: "go.acme.com", tenant: "acme" });
    const link = await core.createLink(
      { tenant: "acme", url: "https://example.com" },
      { actor: { id: "u1" } },
    );
    await core.updateLink("acme", link.id, { title: "New" }, { actor: { id: "u2" } });
    expect(recorded.map((r) => r.action)).toEqual([
      "domain.created",
      "link.created",
      "link.updated",
    ]);
    expect(recorded[2]?.actor?.id).toBe("u2");
    expect(recorded[2]?.metadata?.changed).toEqual(["title"]);
    expect(recorded[0]?.actor?.id).toBe("system");
  });
});
