import { describe, expect, test } from "vitest";
import { createLinksCore } from "../src/core.ts";
import { detectLinksCsvFormat, linksToCsv, normalizeHeader, parseLinksCsv } from "../src/import.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";
import { publicLink } from "../src/core.ts";

describe("format detection", () => {
  test.each([
    [["id", "domain", "slug", "short_url", "url"], "native"],
    [["Short code", "Long URL", "Title"], "shlink"],
    [["shortUrl", "longUrl", "visits"], "shlink"],
    [["address", "target", "description"], "kutt"],
    [["Title", "Bitlink", "Destination URL", "Date created"], "bitly"],
    [["long_url", "custom_bitlinks"], "bitly"],
    [["key", "domain", "url"], "dub"],
    [["Short link", "Destination URL", "Clicks", "Created at"], "dub"],
    [["whatever"], "native"],
  ])("%j → %s", (headers, format) => {
    expect(detectLinksCsvFormat(headers)).toBe(format);
  });

  test("headers normalize to lowercase alphanumerics", () => {
    expect(normalizeHeader("Long URL")).toBe("longurl");
    expect(normalizeHeader("long_url")).toBe("longurl");
    expect(normalizeHeader("longUrl")).toBe("longurl");
  });
});

describe("parseLinksCsv", () => {
  test("bitly dashboard export: custom bitlink wins, domain dropped by default", () => {
    const csv = [
      "Title,Bitlink,Custom Bitlink,Destination URL,Date created,Engagements",
      "Launch,bit.ly/3xYz,go.acme.com/launch,https://acme.com/launch,2025-01-02 10:00:00,12",
      ",https://bit.ly/abc,,https://acme.com/other,2025-01-03,0",
    ].join("\n");
    expect(parseLinksCsv(csv)).toEqual([
      { url: "https://acme.com/launch", slug: "launch", title: "Launch" },
      { url: "https://acme.com/other", slug: "abc" },
    ]);
    expect(parseLinksCsv(csv, { format: "bitly", keepDomains: true })[0]).toMatchObject({
      domain: "go.acme.com",
    });
  });

  test("bitly API-style columns", () => {
    const csv = 'long_url,link,title,tags\nhttps://a.com,https://bit.ly/q1,A,"t1,t2"\n';
    expect(parseLinksCsv(csv, { format: "bitly" })).toEqual([
      { url: "https://a.com", slug: "q1", title: "A", tags: ["t1", "t2"] },
    ]);
  });

  test("dub export with optional columns", () => {
    const csv = [
      "Short link,Destination URL,Clicks,Created at,Tags,Archived,utm_source,Expires at",
      'https://dub.sh/promo,https://acme.com,4,2025-01-01,"a, b",true,newsletter,2030-01-01T00:00:00Z',
    ].join("\n");
    expect(parseLinksCsv(csv, { format: "dub" })).toEqual([
      {
        url: "https://acme.com",
        slug: "promo",
        tags: ["a", "b"],
        archived: true,
        utm: { source: "newsletter" },
        expiresAt: "2030-01-01T00:00:00.000Z",
      },
    ]);
    const api = "key,domain,url,externalId\nlaunch,go.acme.com,https://acme.com,ext_1\n";
    expect(parseLinksCsv(api, { keepDomains: true })).toEqual([
      { url: "https://acme.com", slug: "launch", domain: "go.acme.com", externalId: "ext_1" },
    ]);
  });

  test("shlink: pipe-separated tags, validUntil, maxVisits", () => {
    const csv =
      "Long URL,Short code,Title,Domain,Tags,validUntil,maxVisits\nhttps://a.com,abc,T,s.test,x|y,2030-05-01,10\n";
    expect(parseLinksCsv(csv, { format: "shlink" })).toEqual([
      {
        url: "https://a.com",
        slug: "abc",
        title: "T",
        tags: ["x", "y"],
        expiresAt: "2030-05-01T00:00:00.000Z",
        maxClicks: 10,
      },
    ]);
  });

  test("kutt API columns", () => {
    const csv =
      "address,target,description,link,domain\nk1,https://a.com,Desc,https://kutt.it/k1,\n,https://b.com,,https://kutt.it/k2,\n";
    expect(parseLinksCsv(csv, { format: "kutt" })).toEqual([
      { url: "https://a.com", slug: "k1", description: "Desc" },
      { url: "https://b.com", slug: "k2" },
    ]);
  });

  test("options: forced domain, extra tags; rows without a url keep their index", () => {
    const csv = "url,slug\nhttps://a.com,a\n,b\n";
    const rows = parseLinksCsv(csv, { domain: "Go.Acme.com", tags: ["imported"] });
    expect(rows).toEqual([
      { url: "https://a.com", slug: "a", domain: "go.acme.com", tags: ["imported"] },
      { url: "", slug: "b", domain: "go.acme.com", tags: ["imported"] },
    ]);
  });
});

describe("native round-trip", () => {
  test("linksToCsv → parseLinksCsv → importLinks reproduces the links", async () => {
    const core = createLinksCore({
      storage: createMemoryStorage(),
      defaultDomain: "sho.rt",
      counterFlushMs: 0,
    });
    await core.createLink({
      tenant: "a",
      url: "https://example.com/x",
      slug: "full",
      title: 'Quote "me", please',
      description: "multi\nline",
      tags: ["one", "two"],
      externalId: "ext-1",
      expiresAt: "2030-01-01T00:00:00.000Z",
      expiredUrl: "https://example.com/expired",
      maxClicks: 5,
      ios: "https://apps.apple.com/app/id1",
      android: "https://play.google.com/store/apps/details?id=x.y",
      utm: { source: "s", medium: "m", campaign: "c", term: "t", content: "co" },
      preview: { title: "P", description: "PD", image: "https://example.com/i.png" },
      deepLink: { path: "/p/1", deferred: true },
      redirectStatus: 301,
      trackConversions: true,
      passQuery: false,
      indexable: true,
      disabled: true,
      archived: true,
      rules: [
        { when: [{ field: "country", op: "in", values: ["DE"] }], url: "https://de.example.com" },
      ],
      metadata: { plan: "pro", n: 1 },
      password: "secret",
    });
    const { links } = await core.listLinks("a", { archived: "all" });
    const csv = linksToCsv(links.map(publicLink));
    expect(csv).not.toContain("pbkdf2");
    const rows = parseLinksCsv(csv);
    expect(rows).toHaveLength(1);
    const target = createLinksCore({
      storage: createMemoryStorage(),
      defaultDomain: "sho.rt",
      counterFlushMs: 0,
    });
    const result = await target.importLinks("b", rows);
    expect(result).toMatchObject({ created: 1, errors: 0 });
    const original = links[0]!;
    const copy = result.rows[0]!.link!;
    const strip = ({
      id: _i,
      tenant: _t,
      createdAt: _c,
      updatedAt: _u,
      clicks: _k,
      password: _p,
      rules,
      ...rest
    }: typeof original) => ({
      ...rest,
      rules: rules.map(({ id: _id, ...r }) => r),
    });
    expect(strip(copy)).toEqual(strip(original));
  });
});
