import { describe, expect, test } from "vitest";
import type { ClickEvent } from "../src/index.ts";
import { clickRequest, createTestLinks, USER_AGENTS } from "../src/testing.ts";

const clicks = (events: { type: string }[]) =>
  events.filter((e) => e.type === "click") as ClickEvent[];

describe("redirect handler", () => {
  test("redirects with 302, noindex and no-store, and records an enriched click", async () => {
    const { core, redirects, flush, events } = createTestLinks();
    const link = await core.createLink({ url: "https://example.com/landing", slug: "hi" });
    const res = await redirects.fetch(
      clickRequest("https://sho.rt/hi?utm_source=newsletter", {
        userAgent: USER_AGENTS.iphone,
        country: "DE",
        city: "Berlin",
        referrer: "https://news.ycombinator.com/item?id=1",
        language: "de-DE,de;q=0.9,en;q=0.5",
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/landing?utm_source=newsletter");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    await flush();
    const [click] = clicks(events);
    expect(click).toMatchObject({
      linkId: link.id,
      tenant: "default",
      device: "mobile",
      os: "ios",
      browser: "safari",
      country: "DE",
      continent: "EU",
      city: "Berlin",
      language: "de",
      referrerHost: "news.ycombinator.com",
      bot: false,
      qr: false,
      utm: { source: "newsletter" },
    });
    expect(click?.id).toMatch(/^clk_/);
    expect(click?.ip).toBeUndefined(); // privacy default: drop
    expect(click?.visitor).toMatch(/^[0-9a-f]{24}$/);
    expect(await core.getClickCount("default", link.id)).toBe(1);
  });

  test("falls through (null) for unknown hosts, reserved paths and the bare root", async () => {
    const { core, redirects } = createTestLinks();
    await core.createLink({ url: "https://example.com", slug: "x" });
    expect(await redirects.handle(clickRequest("https://other.example/x"))).toBeNull();
    expect(await redirects.handle(clickRequest("https://sho.rt/api/links"))).toBeNull();
    expect(await redirects.handle(clickRequest("https://sho.rt/"))).toBeNull();
    expect(await redirects.handle(new Request("https://sho.rt/x", { method: "PUT" }))).toBeNull();
    expect((await redirects.fetch(clickRequest("https://other.example/x"))).status).toBe(404);
  });

  test("unknown slugs: domain notFoundUrl, else a 404 page; root goes to rootUrl", async () => {
    const { core, redirects } = createTestLinks();
    await core.createDomain({
      hostname: "go.acme.com",
      notFoundUrl: "https://acme.com/404",
      rootUrl: "https://acme.com",
    });
    const nf = await redirects.fetch(clickRequest("https://go.acme.com/missing"));
    expect(nf.headers.get("location")).toBe("https://acme.com/404");
    const root = await redirects.fetch(clickRequest("https://go.acme.com/"));
    expect(root.headers.get("location")).toBe("https://acme.com");
    const page = await redirects.fetch(clickRequest("https://sho.rt/missing"));
    expect(page.status).toBe(404);
    expect(await page.text()).toContain("Link not found");
  });

  test("honors X-Forwarded-Host and custom redirect status", async () => {
    const { core, redirects } = createTestLinks();
    await core.createLink({
      url: "https://example.com",
      slug: "p",
      redirectStatus: 301,
      indexable: true,
    });
    const res = await redirects.fetch(
      clickRequest("http://127.0.0.1:3000/p", { headers: { "x-forwarded-host": "sho.rt" } }),
    );
    expect(res.status).toBe(301);
    expect(res.headers.get("x-robots-tag")).toBeNull();
  });

  test("disabled links 404; expired links go to expiredUrl or 410", async () => {
    let t = Date.parse("2026-06-01T00:00:00Z");
    const { core, redirects } = createTestLinks({ now: () => t });
    await core.createLink({ url: "https://example.com", slug: "off", disabled: true });
    await core.createLink({
      url: "https://example.com",
      slug: "soon",
      expiresAt: "2026-06-02T00:00:00Z",
      expiredUrl: "https://example.com/ended",
    });
    await core.createLink({
      url: "https://example.com",
      slug: "gone",
      expiresAt: "2026-06-02T00:00:00Z",
    });
    expect((await redirects.fetch(clickRequest("https://sho.rt/off"))).status).toBe(404);
    expect(
      (await redirects.fetch(clickRequest("https://sho.rt/soon"))).headers.get("location"),
    ).toBe("https://example.com/");
    t = Date.parse("2026-06-03T00:00:00Z");
    expect(
      (await redirects.fetch(clickRequest("https://sho.rt/soon"))).headers.get("location"),
    ).toBe("https://example.com/ended");
    expect((await redirects.fetch(clickRequest("https://sho.rt/gone"))).status).toBe(410);
  });

  test("maxClicks expires after the budget (bots don't count)", async () => {
    const { core, redirects, flush } = createTestLinks();
    await core.createLink({ url: "https://example.com", slug: "two", maxClicks: 2 });
    for (let i = 0; i < 2; i++) {
      expect((await redirects.fetch(clickRequest("https://sho.rt/two"))).status).toBe(302);
      await flush();
    }
    expect(
      (await redirects.fetch(clickRequest("https://sho.rt/two", { userAgent: USER_AGENTS.curl })))
        .status,
    ).toBe(410);
  });

  test("password gate: form, wrong password, unlock cookie", async () => {
    const { core, redirects, flush, events } = createTestLinks();
    await core.createLink({ url: "https://example.com/secret", slug: "lock", password: "hunter2" });
    const gate = await redirects.fetch(clickRequest("https://sho.rt/lock"));
    expect(gate.status).toBe(200);
    expect(await gate.text()).toContain("Password required");
    const wrong = await redirects.fetch(
      clickRequest("https://sho.rt/lock", {
        method: "POST",
        body: new URLSearchParams({ password: "nope" }),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
    );
    expect(wrong.status).toBe(401);
    const ok = await redirects.fetch(
      clickRequest("https://sho.rt/lock", {
        method: "POST",
        body: new URLSearchParams({ password: "hunter2" }),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
    );
    expect(ok.status).toBe(303);
    const cookie = ok.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookie).toMatch(/^xl_pw_lnk_/);
    const through = await redirects.fetch(
      clickRequest("https://sho.rt/lock", { headers: { cookie } }),
    );
    expect(through.headers.get("location")).toBe("https://example.com/secret");
    await flush();
    expect(clicks(events)).toHaveLength(1); // only the unlocked visit counts
  });

  test("link-preview bots get Open Graph HTML; clicks are flagged as bots", async () => {
    const { core, redirects, flush, events } = createTestLinks();
    await core.createLink({
      url: "https://example.com",
      slug: "og",
      preview: { title: "Big <Sale>", description: "50% off", image: "https://cdn.example/og.png" },
    });
    const res = await redirects.fetch(
      clickRequest("https://sho.rt/og", { userAgent: USER_AGENTS.slackbot }),
    );
    const html = await res.text();
    expect(html).toContain('<meta property="og:title" content="Big &#60;Sale&#62;">');
    expect(html).toContain("og:image");
    await flush();
    expect(clicks(events)[0]).toMatchObject({ bot: true, device: "bot" });
    expect(await core.getClickCount("default", clicks(events)[0]?.linkId ?? "")).toBe(0);
  });

  test("bots: 'drop' records nothing", async () => {
    const { core, redirects, flush, events } = createTestLinks({ redirect: { bots: "drop" } });
    await core.createLink({ url: "https://example.com", slug: "b" });
    await redirects.fetch(clickRequest("https://sho.rt/b", { userAgent: USER_AGENTS.googlebot }));
    await flush();
    expect(events).toHaveLength(0);
  });

  test("platform destinations, Play Store install referrer", async () => {
    const { core, redirects } = createTestLinks();
    await core.createLink({
      url: "https://example.com",
      slug: "app",
      ios: "https://apps.apple.com/app/id123",
      android: "https://play.google.com/store/apps/details?id=com.acme",
    });
    const ios = await redirects.fetch(
      clickRequest("https://sho.rt/app", { userAgent: USER_AGENTS.iphone }),
    );
    expect(ios.headers.get("location")).toBe("https://apps.apple.com/app/id123");
    const android = await redirects.fetch(
      clickRequest("https://sho.rt/app", { userAgent: USER_AGENTS.android }),
    );
    const loc = new URL(android.headers.get("location") ?? "");
    expect(new URLSearchParams(loc.searchParams.get("referrer") ?? "").get("xl_id")).toMatch(
      /^clk_/,
    );
    const desktop = await redirects.fetch(clickRequest("https://sho.rt/app"));
    expect(desktop.headers.get("location")).toBe("https://example.com/");
  });

  test("rules: geo/device targeting and sticky A/B variants", async () => {
    const { core, redirects, flush, events } = createTestLinks();
    await core.createLink({
      url: "https://example.com/default",
      slug: "r",
      rules: [
        {
          id: "de",
          when: [{ field: "country", op: "in", values: ["DE", "AT"] }],
          url: "https://example.de",
        },
        {
          id: "ab",
          when: [{ field: "device", op: "in", values: ["desktop"] }],
          variants: [
            { id: "a", url: "https://example.com/a", weight: 1 },
            { id: "b", url: "https://example.com/b", weight: 1 },
          ],
        },
      ],
    });
    expect(
      (await redirects.fetch(clickRequest("https://sho.rt/r", { country: "AT" }))).headers.get(
        "location",
      ),
    ).toBe("https://example.de/");
    expect(
      (
        await redirects.fetch(
          clickRequest("https://sho.rt/r", { userAgent: USER_AGENTS.iphone, country: "US" }),
        )
      ).headers.get("location"),
    ).toBe("https://example.com/default");
    const first = (
      await redirects.fetch(clickRequest("https://sho.rt/r", { ip: "198.51.100.1" }))
    ).headers.get("location");
    for (let i = 0; i < 3; i++) {
      expect(
        (
          await redirects.fetch(clickRequest("https://sho.rt/r", { ip: "198.51.100.1" }))
        ).headers.get("location"),
      ).toBe(first);
    }
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      seen.add(
        (
          await redirects.fetch(clickRequest("https://sho.rt/r", { ip: `198.51.100.${i + 10}` }))
        ).headers.get("location") ?? "",
      );
    }
    expect(seen).toEqual(new Set(["https://example.com/a", "https://example.com/b"]));
    await flush();
    expect(clicks(events)[0]).toMatchObject({ ruleId: "de" });
    expect(clicks(events).find((c) => c.ruleId === "ab")?.variant).toMatch(/^[ab]$/);
  });

  test("UTM merge, query pass-through, qr flag stripped, conversion click id", async () => {
    const { core, redirects, flush, events } = createTestLinks();
    const link = await core.createLink({
      url: "https://example.com/p?ref=x",
      slug: "u",
      utm: { source: "qr-poster", campaign: "spring" },
      trackConversions: true,
    });
    const res = await redirects.fetch(clickRequest("https://sho.rt/u?qr=1&color=red&ref=y"));
    const loc = new URL(res.headers.get("location") ?? "");
    expect(loc.searchParams.get("utm_source")).toBe("qr-poster");
    expect(loc.searchParams.get("color")).toBe("red");
    expect(loc.searchParams.get("ref")).toBe("x"); // destination wins
    expect(loc.searchParams.has("qr")).toBe(false);
    const clickId = loc.searchParams.get("xl_id");
    expect(clickId).toMatch(/^clk_/);
    await flush();
    expect(clicks(events)[0]).toMatchObject({ id: clickId, qr: true });
    expect(await core.getClickRef(clickId ?? "")).toMatchObject({ linkId: link.id });
    const lead = await core.trackLead({ clickId: clickId ?? "", customerId: "u1" });
    expect(lead?.event.linkId).toBe(link.id);
  });

  test("passQuery: false drops the short URL's query", async () => {
    const { core, redirects } = createTestLinks();
    await core.createLink({ url: "https://example.com/", slug: "nq", passQuery: false });
    expect(
      (await redirects.fetch(clickRequest("https://sho.rt/nq?a=1"))).headers.get("location"),
    ).toBe("https://example.com/");
  });

  test("deferred deep links: mobile clicks leave a claimable handoff", async () => {
    const { core, redirects, flush, events } = createTestLinks();
    await core.createLink({
      url: "https://example.com",
      slug: "dl",
      ios: "https://apps.apple.com/app/id1",
      deepLink: { path: "/product/42", deferred: true },
    });
    await redirects.fetch(clickRequest("https://sho.rt/dl", { userAgent: USER_AGENTS.iphone }));
    await flush();
    const clickId = clicks(events)[0]?.id ?? "";
    const claimed = await core.claimDeferred({ clickId });
    expect(claimed).toMatchObject({
      matchType: "exact",
      handoff: { path: "/product/42", os: "ios" },
    });
  });

  test("serves .well-known association files for configured domains", async () => {
    const { core, redirects } = createTestLinks();
    await core.createDomain({
      hostname: "go.acme.com",
      apps: {
        ios: { appIds: ["ABCDE12345.com.acme.app"] },
        android: [
          { packageName: "com.acme.app", sha256CertFingerprints: [Array(32).fill("AB").join(":")] },
        ],
      },
    });
    const aasa = await redirects.fetch(
      clickRequest("https://go.acme.com/.well-known/apple-app-site-association"),
    );
    expect(aasa.headers.get("content-type")).toBe("application/json");
    expect(await aasa.json()).toMatchObject({
      applinks: { details: [{ appIDs: ["ABCDE12345.com.acme.app"] }] },
    });
    const al = await redirects.fetch(
      clickRequest("https://go.acme.com/.well-known/assetlinks.json"),
    );
    expect(await al.json()).toMatchObject([{ target: { package_name: "com.acme.app" } }]);
    expect(
      await redirects.handle(clickRequest("https://sho.rt/.well-known/assetlinks.json")),
    ).toBeNull();
  });

  test("basePath serves path-prefixed links on any host", async () => {
    const { core, redirects } = createTestLinks({
      redirect: { basePath: "/l", defaultDomain: "sho.rt" },
    });
    await core.createLink({ url: "https://example.com", slug: "x" });
    expect(
      (await redirects.handle(clickRequest("https://app.example/l/x")))?.headers.get("location"),
    ).toBe("https://example.com/");
    expect(await redirects.handle(clickRequest("https://app.example/x"))).toBeNull();
  });

  test("privacy modes and DNT", async () => {
    const { core, redirects, flush, events } = createTestLinks({
      redirect: {
        privacy: { ip: "truncate", visitor: "none", respectDoNotTrack: true, salt: "s" },
      },
    });
    await core.createLink({ url: "https://example.com", slug: "p" });
    await redirects.fetch(clickRequest("https://sho.rt/p", { ip: "203.0.113.99" }));
    await redirects.fetch(clickRequest("https://sho.rt/p", { headers: { dnt: "1" } }));
    await flush();
    expect(clicks(events)).toHaveLength(1);
    expect(clicks(events)[0]?.ip).toBe("203.0.113.0");
    expect(clicks(events)[0]?.visitor).toBeUndefined();
  });

  test("never throws: storage failures degrade to fall-through / last known good", async () => {
    const { core, storage, redirects } = createTestLinks({
      redirect: { resolver: { ttlMs: 1, negativeTtlMs: 1 }, onError: () => {} },
    });
    await core.createLink({ url: "https://example.com", slug: "x" });
    expect((await redirects.fetch(clickRequest("https://sho.rt/x"))).status).toBe(302);
    storage.getItem = async () => {
      throw new Error("db down");
    };
    await new Promise((r) => setTimeout(r, 5));
    // Cached entry is stale; served as last known good.
    expect((await redirects.fetch(clickRequest("https://sho.rt/x"))).status).toBe(302);
    expect(await redirects.handle(clickRequest("https://sho.rt/never-seen"))).not.toBeInstanceOf(
      Error,
    );
  });

  test("onClick tap and HEAD requests (no recording)", async () => {
    const tapped: string[] = [];
    const { core, redirects, flush, events } = createTestLinks({
      redirect: { onClick: (e) => tapped.push(e.slug) },
    });
    await core.createLink({ url: "https://example.com", slug: "t" });
    await redirects.fetch(clickRequest("https://sho.rt/t", { method: "HEAD" }));
    expect(events).toHaveLength(0);
    await redirects.fetch(clickRequest("https://sho.rt/t"));
    await flush();
    expect(tapped).toEqual(["t"]);
  });
});
