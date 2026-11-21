import { describe, expect, test } from "vitest";
import {
  ConflictError,
  createLinksCore,
  HookDeniedError,
  NotFoundError,
  publicLink,
  ReadonlyError,
  ValidationError,
  type AfterEvent,
} from "../src/index.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";
import { createCollectingSink } from "../src/testing.ts";

const make = (
  extra: Parameters<typeof createLinksCore>[0] extends infer O ? Partial<O> : never = {},
) =>
  createLinksCore({
    storage: createMemoryStorage(),
    analytics: createCollectingSink(),
    defaultDomain: "sho.rt",
    counterFlushMs: 0,
    ...extra,
  });

describe("links", () => {
  test("creates a link on the default domain with a generated slug", async () => {
    const core = make();
    const link = await core.createLink({ url: "https://example.com/a" });
    expect(link.id).toMatch(/^lnk_/);
    expect(link.tenant).toBe("default");
    expect(link.domain).toBe("sho.rt");
    expect(link.slug).toMatch(/^[23456789a-z]{7}$/);
    expect(await core.getLinkBySlug("sho.rt", link.slug)).toEqual(link);
    expect((await core.listTenants()).map((t) => t.key)).toEqual(["default"]);
  });

  test("custom slugs are unique per domain and case-insensitive by default", async () => {
    const core = make();
    await core.createLink({ url: "https://a.example", slug: "Sale" });
    await expect(core.createLink({ url: "https://b.example", slug: "sale" })).rejects.toThrow(
      ConflictError,
    );
    expect((await core.getLinkBySlug("SHO.RT", "SALE"))?.slug).toBe("Sale");
  });

  test("case-sensitive domains keep Sale and sale apart", async () => {
    const core = make();
    await core.createDomain({ hostname: "cs.link", caseSensitive: true });
    await core.createLink({ url: "https://a.example", slug: "Sale", domain: "cs.link" });
    await core.createLink({ url: "https://b.example", slug: "sale", domain: "cs.link" });
    expect((await core.getLinkBySlug("cs.link", "Sale"))?.url).toBe("https://a.example");
    expect((await core.getLinkBySlug("cs.link", "sale"))?.url).toBe("https://b.example");
  });

  test("validates input", async () => {
    const core = make();
    await expect(core.createLink({ url: "javascript:alert(1)" })).rejects.toThrow(ValidationError);
    await expect(core.createLink({ url: "not a url" })).rejects.toThrow(ValidationError);
    await expect(core.createLink({ url: "https://x.example", slug: "api" })).rejects.toThrow(
      /reserved/,
    );
    await expect(core.createLink({ url: "https://x.example", slug: "a/../b" })).rejects.toThrow(
      ValidationError,
    );
    await expect(
      core.createLink({ url: "https://x.example", rules: [{ when: [] }] }),
    ).rejects.toThrow(/url or variants/);
    await expect(
      core.createLink({ url: "https://x.example", domain: "nope.example" }),
    ).rejects.toThrow(NotFoundError);
  });

  test("allows nested slugs and app schemes", async () => {
    const core = make();
    const link = await core.createLink({ url: "myapp://product/42", slug: "docs/intro" });
    expect((await core.getLinkBySlug("sho.rt", "docs/intro"))?.id).toBe(link.id);
  });

  test("tenant-owned domains are private to their tenant", async () => {
    const core = make();
    await core.createDomain({ hostname: "go.acme.com", tenant: "acme", isDefault: true });
    const own = await core.createLink({ tenant: "acme", url: "https://acme.example" });
    expect(own.domain).toBe("go.acme.com");
    await expect(
      core.createLink({ tenant: "other", url: "https://x.example", domain: "go.acme.com" }),
    ).rejects.toThrow(/another tenant/);
    expect((await core.listDomains({ tenant: "other" })).map((d) => d.hostname)).toEqual([
      "sho.rt",
    ]);
    expect((await core.listDomains({ tenant: "acme" })).map((d) => d.hostname)).toEqual([
      "go.acme.com",
      "sho.rt",
    ]);
  });

  test("updates move slugs atomically and free the old one", async () => {
    const core = make();
    const link = await core.createLink({ url: "https://a.example", slug: "old" });
    await core.createLink({ url: "https://b.example", slug: "taken" });
    await expect(core.updateLink("default", link.id, { slug: "taken" })).rejects.toThrow(
      ConflictError,
    );
    const updated = await core.updateLink("default", link.id, { slug: "new", title: "T" });
    expect(updated.slug).toBe("new");
    expect(updated.title).toBe("T");
    expect(await core.getLinkBySlug("sho.rt", "old")).toBeNull();
    expect((await core.getLinkBySlug("sho.rt", "new"))?.id).toBe(link.id);
    const cleared = await core.updateLink("default", link.id, { title: null });
    expect(cleared.title).toBeUndefined();
  });

  test("external ids are unique and searchable", async () => {
    const core = make();
    const link = await core.createLink({ url: "https://a.example", externalId: "post-1" });
    await expect(
      core.createLink({ url: "https://b.example", externalId: "post-1" }),
    ).rejects.toThrow(ConflictError);
    expect((await core.getLinkByExternalId("default", "post-1"))?.id).toBe(link.id);
    await core.updateLink("default", link.id, { externalId: "post-2" });
    expect(await core.getLinkByExternalId("default", "post-1")).toBeNull();
    expect((await core.getLinkByExternalId("default", "post-2"))?.id).toBe(link.id);
  });

  test("passwords are hashed and never public", async () => {
    const core = make();
    const link = await core.createLink({ url: "https://a.example", password: "s3cret" });
    expect(link.password?.algorithm).toBe("pbkdf2-sha256");
    const pub = publicLink(link);
    expect(pub.hasPassword).toBe(true);
    expect("password" in pub).toBe(false);
    const cleared = await core.updateLink("default", link.id, { password: null });
    expect(cleared.password).toBeUndefined();
  });

  test("lists, filters, searches and paginates newest first", async () => {
    let t = Date.parse("2026-01-01T00:00:00Z");
    const core = make({ now: () => (t += 1000) });
    for (let i = 0; i < 7; i++) {
      await core.createLink({
        url: `https://example.com/${i}`,
        slug: `s${i}`,
        tags: i % 2 ? ["odd"] : ["even"],
        archived: i === 6,
      });
    }
    const page1 = await core.listLinks("default", { limit: 4 });
    expect(page1.total).toBe(6);
    expect(page1.links.map((l) => l.slug)).toEqual(["s5", "s4", "s3", "s2"]);
    const page2 = await core.listLinks("default", { limit: 4, cursor: page1.nextCursor });
    expect(page2.links.map((l) => l.slug)).toEqual(["s1", "s0"]);
    expect(page2.nextCursor).toBeUndefined();
    expect((await core.listLinks("default", { tag: "odd" })).total).toBe(3);
    expect((await core.listLinks("default", { search: "example.com/3" })).links[0]?.slug).toBe(
      "s3",
    );
    expect((await core.listLinks("default", { archived: true })).links.map((l) => l.slug)).toEqual([
      "s6",
    ]);
    expect((await core.listLinks("default", { archived: "all" })).total).toBe(7);
    expect(await core.listTags("default")).toEqual([
      { tag: "even", count: 4 },
      { tag: "odd", count: 3 },
    ]);
  });

  test("deletes links and their pointers", async () => {
    const core = make();
    const link = await core.createLink({ url: "https://a.example", slug: "gone" });
    await core.deleteLink("default", link.id);
    expect(await core.getLinkBySlug("sho.rt", "gone")).toBeNull();
    await expect(core.deleteLink("default", link.id)).rejects.toThrow(NotFoundError);
    // The slug is free again.
    await core.createLink({ url: "https://b.example", slug: "gone" });
  });

  test("readonly blocks mutations", async () => {
    const core = make({ readonly: true });
    await expect(core.createLink({ url: "https://a.example" })).rejects.toThrow(ReadonlyError);
  });

  test("click counters batch and flush", async () => {
    const core = make();
    const link = await core.createLink({ url: "https://a.example" });
    core.countClick("default", link.id);
    core.countClick("default", link.id);
    expect(await core.getClickCount("default", link.id)).toBe(2);
    await core.flushCounters();
    core.countClick("default", link.id);
    expect(await core.getClickCount("default", link.id)).toBe(3);
    await core.close();
    expect((await core.listLinks("default")).links[0]?.clicks).toBe(3);
  });
});

describe("domains and tenants", () => {
  test("domain lifecycle", async () => {
    const core = make();
    await core.createDomain({ hostname: "Go.Example.com", rootUrl: "https://example.com" });
    await expect(core.createDomain({ hostname: "go.example.com" })).rejects.toThrow(ConflictError);
    await expect(core.createDomain({ hostname: "https://bad" })).rejects.toThrow(ValidationError);
    const link = await core.createLink({ url: "https://a.example", domain: "go.example.com" });
    await expect(core.deleteDomain("go.example.com")).rejects.toThrow(ConflictError);
    await expect(core.updateDomain("go.example.com", { caseSensitive: true })).rejects.toThrow(
      ConflictError,
    );
    const updated = await core.updateDomain("go.example.com", {
      notFoundUrl: "https://example.com/404",
    });
    expect(updated.notFoundUrl).toBe("https://example.com/404");
    await core.deleteDomain("go.example.com", { force: true });
    expect(await core.getLink("default", link.id)).toBeNull();
    expect(await core.getDomain("go.example.com")).toBeNull();
  });

  test("only one default domain per owner", async () => {
    const core = make();
    await core.createDomain({ hostname: "a.link", isDefault: true });
    expect((await core.getDomain("sho.rt"))?.isDefault).toBe(false);
    expect((await core.createLink({ url: "https://x.example" })).domain).toBe("a.link");
  });

  test("tenant upsert and cascade delete", async () => {
    const core = make();
    await core.upsertTenant({ key: "acme", name: "Acme" });
    await core.createDomain({ hostname: "go.acme.com", tenant: "acme" });
    const link = await core.createLink({ tenant: "acme", url: "https://a.example", slug: "x" });
    expect((await core.getTenant("acme"))?.name).toBe("Acme");
    await core.deleteTenant("acme");
    expect(await core.getTenant("acme")).toBeNull();
    expect(await core.getLink("acme", link.id)).toBeNull();
    expect(await core.getLinkBySlug("sho.rt", "x")).toBeNull();
    expect(await core.getDomain("go.acme.com")).toBeNull();
  });

  test("audit log records mutations, newest first", async () => {
    const core = make();
    const link = await core.createLink({ url: "https://a.example" }, { actor: { id: "u1" } });
    await core.updateLink("default", link.id, { title: "x" }, { actor: { id: "u2" } });
    const log = await core.listAudit("default");
    expect(log.map((e) => e.action)).toEqual(["link.updated", "link.created"]);
    expect(log[0]?.actor?.id).toBe("u2");
  });
});

describe("hooks", () => {
  test("before can deny, after observes", async () => {
    const seen: AfterEvent["type"][] = [];
    const core = make({
      hooks: {
        before(event) {
          if (event.type === "link.create" && event.link.url.includes("blocked")) {
            throw new HookDeniedError("blocked", { status: 402 });
          }
        },
        after(event) {
          seen.push(event.type);
        },
      },
    });
    await expect(core.createLink({ url: "https://blocked.example" })).rejects.toMatchObject({
      status: 402,
    });
    const link = await core.createLink({ url: "https://ok.example" });
    await core.deleteLink("default", link.id);
    expect(seen).toEqual(["link.created", "link.deleted"]);
  });

  test("after-hook errors are reported, not thrown", async () => {
    const errors: unknown[] = [];
    const core = make({
      hooks: {
        after() {
          throw new Error("boom");
        },
      },
      onHookError: (e) => errors.push(e),
    });
    await core.createLink({ url: "https://ok.example" });
    expect(errors).toHaveLength(1);
  });
});

describe("import", () => {
  test("creates, skips, updates and reports errors per row", async () => {
    const core = make();
    await core.createLink({ url: "https://a.example", slug: "a" });
    const rows = [
      { url: "https://a2.example", slug: "a" },
      { url: "https://b.example", slug: "b" },
      { url: "bad", slug: "c" },
    ];
    const dry = await core.importLinks("default", rows, { dryRun: true });
    expect([dry.created, dry.skipped, dry.errors]).toEqual([1, 1, 1]);
    expect(await core.getLinkBySlug("sho.rt", "b")).toBeNull();
    const skip = await core.importLinks("default", rows);
    expect([skip.created, skip.skipped, skip.errors]).toEqual([1, 1, 1]);
    expect(skip.rows[2]?.error).toMatch(/url/);
    const update = await core.importLinks("default", rows.slice(0, 1), { onConflict: "update" });
    expect(update.updated).toBe(1);
    expect((await core.getLinkBySlug("sho.rt", "a"))?.url).toBe("https://a2.example");
  });
});

describe("conversions", () => {
  test("lead binds a customer to a click; sale follows the customer, idempotent by invoice", async () => {
    const sink = createCollectingSink();
    const core = make({ analytics: sink });
    const link = await core.createLink({ url: "https://a.example", trackConversions: true });
    await core.recordClickRef({
      clickId: "clk_1",
      tenant: "default",
      linkId: link.id,
      domain: link.domain,
      slug: link.slug,
      at: new Date().toISOString(),
    });
    expect(await core.trackLead({ clickId: "clk_unknown", customerId: "c1" })).toBeNull();
    const lead = await core.trackLead({
      clickId: "clk_1",
      customerId: "c1",
      customerEmail: "a@b.c",
    });
    expect(lead?.event).toMatchObject({
      type: "lead",
      linkId: link.id,
      clickId: "clk_1",
      name: "Sign up",
    });
    expect(lead?.customer.email).toBe("a@b.c");
    const sale = await core.trackSale({
      customerId: "c1",
      amount: 4999,
      currency: "eur",
      invoiceId: "inv_1",
    });
    expect(sale?.event).toMatchObject({
      type: "sale",
      amount: 4999,
      currency: "EUR",
      linkId: link.id,
    });
    const again = await core.trackSale({ customerId: "c1", amount: 4999, invoiceId: "inv_1" });
    expect(again?.duplicate).toBe(true);
    expect(await core.trackSale({ customerId: "nobody", amount: 1 })).toBeNull();
    expect(sink.collected.map((e) => e.type)).toEqual(["lead", "sale"]);
    expect((await core.listCustomers("default")).map((c) => c.id)).toEqual(["c1"]);
    await expect(core.trackSale({ customerId: "c1", amount: -1 })).rejects.toThrow(ValidationError);
  });

  test("prune drops expired click refs and handoffs", async () => {
    let t = Date.parse("2026-01-01T00:00:00Z");
    const core = make({ now: () => t, attributionWindow: "1d" });
    await core.recordClickRef({
      clickId: "clk_old",
      tenant: "default",
      linkId: "lnk_x",
      domain: "",
      slug: "",
      at: new Date(t).toISOString(),
    });
    await core.saveDeferred(
      {
        clickId: "clk_d",
        tenant: "default",
        linkId: "lnk_x",
        path: "/p",
        url: "https://x",
        os: "ios",
        at: new Date(t).toISOString(),
        expiresAt: new Date(t + 1000).toISOString(),
      },
      "fp",
    );
    t += 2 * 86_400_000;
    expect(await core.prune()).toEqual({ clickRefs: 1, deferred: 1 });
  });
});

describe("deferred deep links", () => {
  test("claims exactly once, by click id or fingerprint", async () => {
    const core = make();
    const base = {
      tenant: "default",
      linkId: "lnk_x",
      url: "https://apps.apple.com/x",
      os: "ios",
      at: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    await core.saveDeferred({ ...base, clickId: "clk_01A", path: "/a" }, "fp1");
    await core.saveDeferred({ ...base, clickId: "clk_01B", path: "/b" }, "fp1");
    const exact = await core.claimDeferred({ clickId: "clk_01A" });
    expect(exact).toMatchObject({ matchType: "exact", handoff: { path: "/a" } });
    expect(await core.claimDeferred({ clickId: "clk_01A" })).toBeNull();
    const fuzzy = await core.claimDeferred({ fingerprint: "fp1" });
    expect(fuzzy).toMatchObject({ matchType: "probabilistic", handoff: { path: "/b" } });
    expect(await core.claimDeferred({ fingerprint: "fp1" })).toBeNull();
  });
});

describe("import echo", () => {
  test("rows echo their input without the plain-text password", async () => {
    const core = make();
    const res = await core.importLinks(
      "default",
      [{ url: "https://a.example", slug: "p", password: "secret" }],
      { dryRun: true },
    );
    expect(res.rows[0]?.input).toEqual({ url: "https://a.example", slug: "p", hasPassword: true });
  });
});
