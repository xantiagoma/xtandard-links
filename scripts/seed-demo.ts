/**
 * Realistic demo data for the admin UI, the e2e suite, `bun run demo` and the
 * README screenshots: three tenants, shared + branded domains (one with iOS /
 * Android app association), ~40 links with tags, UTM, targeting rules, A/B
 * splits, a password, expiring / capped / archived / disabled links, and
 * ~5 000 synthetic clicks over 90 days (countries, devices, referrers, QR
 * scans, variants) plus attributed leads and sales — all ingested through the
 * core's analytics sink, exactly like real traffic.
 *
 * Deterministic: a seeded PRNG drives every choice, so screenshots are stable.
 *
 *   import { seedDemo } from "./scripts/seed-demo.ts";
 *   await seedDemo(core, { clock });   // backdates createdAt / audit entries
 *
 *   bun scripts/seed-demo.ts           // dry run: prints what it would create
 *
 * @module
 */

import type { CreateLinkInput, LinksCore } from "../src/core.ts";
import { newId } from "../src/id.ts";
import type { ClickEvent, DeviceType, Domain } from "../src/schema.ts";

export interface SeedDemoOptions {
  /** "Now" for the dataset (default: the current time). */
  now?: number;
  /** Number of synthetic clicks (default 5000). */
  clicks?: number;
  /**
   * Pin the core's clock while seeding (pass `undefined` to release it), so
   * links and audit entries get spread-out creation times. Without it every
   * record is created "now".
   */
  clock?: (ms: number | undefined) => void;
  /** Seed for the PRNG (default 42). */
  seed?: number;
}

export interface SeedDemoResult {
  tenants: string[];
  links: number;
  clicks: number;
  leads: number;
  sales: number;
  /** Ids of a few notable links (for tests and screenshots). */
  ids: { spring: string; app: string; abTest: string; password: string };
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** mulberry32 — tiny deterministic PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Weighted<T> = readonly (readonly [T, number])[];

function picker(random: () => number) {
  return <T>(items: Weighted<T>): T => {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = random() * total;
    for (const [item, w] of items) {
      r -= w;
      if (r <= 0) return item;
    }
    return items[items.length - 1]![0];
  };
}

const FINGERPRINT = Array.from({ length: 32 }, (_, i) =>
  ((i * 37 + 11) % 256).toString(16).padStart(2, "0").toUpperCase(),
).join(":");

const DOMAINS: Domain[] = [
  {
    hostname: "lnks.dev",
    rootUrl: "https://xtandard.dev",
    isDefault: true,
  },
  {
    hostname: "go.acme.com",
    tenant: "acme",
    rootUrl: "https://acme.com",
    notFoundUrl: "https://acme.com/404",
    isDefault: true,
    slugLength: 6,
    apps: {
      ios: { appIds: ["ABCDE12345.com.acme.shop"], paths: ["/app/*", "/p/*"] },
      android: [{ packageName: "com.acme.shop", sha256CertFingerprints: [FINGERPRINT] }],
    },
  },
  { hostname: "acme.link", tenant: "acme", rootUrl: "https://acme.com" },
  { hostname: "glbx.co", tenant: "globex", rootUrl: "https://globex.com", isDefault: true },
];

/** Links per tenant. `weight` = relative traffic share within the tenant. */
interface SeedLink {
  input: CreateLinkInput;
  weight: number;
  /** Days ago the link was created (clicks only happen after it). */
  age: number;
  key?: keyof SeedDemoResult["ids"];
}

function acmeLinks(now: number): SeedLink[] {
  const iso = (ms: number) => new Date(ms).toISOString();
  const L = (
    input: Omit<CreateLinkInput, "tenant">,
    weight: number,
    age: number,
    key?: SeedLink["key"],
  ): SeedLink => ({
    input: { tenant: "acme", ...input },
    weight,
    age,
    key,
  });
  return [
    L(
      {
        domain: "go.acme.com",
        slug: "spring",
        url: "https://acme.com/sale/spring",
        title: "Spring sale",
        tags: ["campaign", "sale"],
        utm: { source: "newsletter", medium: "email", campaign: "spring_sale" },
        trackConversions: true,
        rules: [
          {
            name: "Germany & Austria",
            when: [{ field: "country", op: "in", values: ["DE", "AT"] }],
            url: "https://acme.com/de/sale/fruehling",
          },
          {
            name: "Mobile app users",
            when: [
              { field: "device", op: "in", values: ["mobile"] },
              { field: "os", op: "in", values: ["ios", "android"] },
            ],
            url: "https://acme.com/app/sale",
          },
        ],
        preview: {
          title: "Spring sale — up to 40% off",
          description: "Fresh gear for the season. Ends April 30.",
          image: "https://acme.com/og/spring.png",
        },
      },
      14,
      62,
      "spring",
    ),
    L(
      {
        domain: "go.acme.com",
        slug: "app",
        url: "https://acme.com/app",
        title: "Get the Acme app",
        tags: ["app", "mobile"],
        ios: "https://apps.apple.com/app/id1234567890",
        android: "https://play.google.com/store/apps/details?id=com.acme.shop",
        deepLink: { path: "/home", deferred: true },
        trackConversions: true,
      },
      10,
      88,
      "app",
    ),
    L(
      {
        domain: "go.acme.com",
        slug: "pricing-test",
        url: "https://acme.com/pricing",
        title: "Pricing page A/B test",
        tags: ["experiment", "pricing"],
        trackConversions: true,
        rules: [
          {
            name: "Pricing layout",
            when: [],
            variants: [
              { id: "a", url: "https://acme.com/pricing?layout=cards", weight: 50 },
              { id: "b", url: "https://acme.com/pricing?layout=table", weight: 30 },
              { id: "c", url: "https://acme.com/pricing?layout=slider", weight: 20 },
            ],
          },
        ],
      },
      9,
      40,
      "abTest",
    ),
    L(
      {
        domain: "go.acme.com",
        slug: "investors",
        url: "https://acme.com/ir/q3-deck.pdf",
        title: "Q3 investor deck",
        tags: ["internal"],
        password: "acme-q3",
        expiresAt: iso(now + 12 * DAY),
        expiredUrl: "https://acme.com/ir",
      },
      1,
      20,
      "password",
    ),
    L(
      {
        domain: "go.acme.com",
        slug: "black-friday",
        url: "https://acme.com/sale/black-friday",
        title: "Black Friday early access",
        tags: ["campaign", "sale"],
        utm: { source: "instagram", medium: "social", campaign: "bf_2026" },
        expiresAt: iso(now + 9 * DAY),
        trackConversions: true,
      },
      6,
      12,
    ),
    L(
      {
        domain: "go.acme.com",
        slug: "summer",
        url: "https://acme.com/sale/summer",
        title: "Summer sale (ended)",
        tags: ["campaign", "sale"],
        expiresAt: iso(now - 20 * DAY),
        expiredUrl: "https://acme.com/sale",
        utm: { source: "newsletter", medium: "email", campaign: "summer_sale" },
      },
      4,
      85,
    ),
    L(
      {
        domain: "go.acme.com",
        slug: "beta",
        url: "https://acme.com/beta/signup",
        title: "Private beta (first 500)",
        tags: ["product"],
        maxClicks: 500,
        trackConversions: true,
      },
      3,
      30,
    ),
    L(
      {
        domain: "go.acme.com",
        slug: "qr-store",
        url: "https://acme.com/stores/berlin",
        title: "Berlin store window QR",
        tags: ["qr", "retail"],
        rules: [
          {
            name: "Scanned in store",
            when: [{ field: "qr", op: "in", values: ["true"] }],
            url: "https://acme.com/stores/berlin?welcome=1",
          },
        ],
      },
      5,
      70,
    ),
    L(
      {
        domain: "go.acme.com",
        slug: "docs",
        url: "https://docs.acme.com",
        title: "Developer docs",
        tags: ["docs"],
        rules: [
          {
            name: "Language: German",
            when: [{ field: "language", op: "in", values: ["de"] }],
            url: "https://docs.acme.com/de",
          },
          {
            name: "From GitHub",
            when: [{ field: "referrer", op: "in", values: ["github.com"] }],
            url: "https://docs.acme.com/quickstart",
          },
        ],
      },
      7,
      90,
    ),
    L(
      {
        domain: "go.acme.com",
        slug: "launch-week",
        url: "https://acme.com/launch-week",
        title: "Launch week",
        tags: ["campaign", "product"],
        utm: { source: "twitter", medium: "social", campaign: "launch_week" },
        rules: [
          {
            name: "Before the keynote",
            when: [{ field: "time", before: iso(now - 25 * DAY) }],
            url: "https://acme.com/launch-week/teaser",
          },
        ],
      },
      6,
      45,
    ),
    L(
      {
        domain: "go.acme.com",
        slug: "partner",
        url: "https://acme.com/partners",
        title: "Partner referral",
        tags: ["partners"],
        rules: [
          {
            name: "Partner code",
            when: [{ field: "query", key: "ref", op: "exists" }],
            url: "https://acme.com/partners/welcome",
          },
        ],
        trackConversions: true,
      },
      3,
      55,
    ),
    L(
      {
        domain: "go.acme.com",
        slug: "careers",
        url: "https://acme.com/careers",
        title: "We're hiring",
        tags: ["hiring"],
      },
      3,
      80,
    ),
    L(
      {
        domain: "go.acme.com",
        slug: "webinar",
        url: "https://acme.com/events/webinar-scaling",
        title: "Webinar: scaling checkout",
        tags: ["events"],
        utm: { source: "linkedin", medium: "social", campaign: "webinar_q4" },
      },
      3,
      28,
    ),
    L(
      {
        domain: "go.acme.com",
        slug: "yt",
        url: "https://www.youtube.com/@acme",
        title: "YouTube channel",
        tags: ["social"],
      },
      2,
      75,
    ),
    L(
      {
        domain: "go.acme.com",
        slug: "status",
        url: "https://status.acme.com",
        title: "Status page",
        tags: ["support"],
      },
      1,
      90,
    ),
    L(
      {
        domain: "go.acme.com",
        slug: "help",
        url: "https://help.acme.com",
        title: "Help center",
        tags: ["support"],
      },
      2,
      90,
    ),
    L(
      {
        domain: "acme.link",
        slug: "p/42",
        url: "https://acme.com/products/42-trail-runner",
        title: "Trail runner (product 42)",
        tags: ["product", "mobile"],
        deepLink: { path: "/p/42" },
        ios: "https://apps.apple.com/app/id1234567890",
        trackConversions: true,
      },
      4,
      35,
    ),
    L(
      {
        domain: "acme.link",
        slug: "p/77",
        url: "https://acme.com/products/77-city-jacket",
        title: "City jacket (product 77)",
        tags: ["product"],
        trackConversions: true,
      },
      3,
      33,
    ),
    L(
      {
        domain: "go.acme.com",
        slug: "podcast",
        url: "https://acme.com/podcast/ep-12",
        title: "Podcast ep. 12",
        tags: ["content"],
        utm: { source: "podcast", medium: "audio" },
      },
      2,
      26,
    ),
    L(
      {
        domain: "go.acme.com",
        slug: "survey",
        url: "https://forms.acme.com/nps",
        title: "NPS survey",
        tags: ["research"],
        disabled: true,
      },
      1,
      65,
    ),
    L(
      {
        domain: "go.acme.com",
        slug: "holiday-2025",
        url: "https://acme.com/sale/holiday",
        title: "Holiday 2025",
        tags: ["campaign", "sale"],
        archived: true,
      },
      1,
      89,
    ),
    L(
      {
        domain: "lnks.dev",
        url: "https://acme.com/blog/how-we-ship",
        title: "Blog: how we ship",
        tags: ["blog", "content"],
        utm: { source: "hackernews", medium: "social" },
      },
      5,
      18,
    ),
    L(
      {
        domain: "lnks.dev",
        url: "https://acme.com/blog/postgres-at-scale",
        title: "Blog: Postgres at scale",
        tags: ["blog", "content"],
      },
      3,
      50,
    ),
    L(
      {
        domain: "go.acme.com",
        slug: "gift",
        url: "https://acme.com/gift-cards",
        title: "Gift cards",
        tags: ["sale"],
        trackConversions: true,
      },
      2,
      15,
    ),
    L(
      {
        domain: "go.acme.com",
        slug: "returns",
        url: "https://help.acme.com/returns",
        title: "Returns policy",
        tags: ["support"],
        redirectStatus: 301,
      },
      1,
      90,
    ),
    L(
      {
        domain: "go.acme.com",
        slug: "store-locator",
        url: "https://acme.com/stores",
        title: "Store locator",
        tags: ["retail"],
        rules: [
          {
            name: "Europe",
            when: [{ field: "continent", op: "in", values: ["EU"] }],
            url: "https://acme.com/eu/stores",
          },
        ],
      },
      2,
      60,
    ),
    L(
      {
        domain: "go.acme.com",
        slug: "newsletter",
        url: "https://acme.com/newsletter",
        title: "Newsletter signup",
        tags: ["content"],
        trackConversions: true,
      },
      3,
      58,
    ),
    L(
      {
        domain: "go.acme.com",
        slug: "affiliate-x",
        url: "https://acme.com/?aff=x",
        title: "Affiliate X",
        tags: ["partners"],
        passQuery: false,
      },
      1,
      22,
    ),
  ];
}

function otherLinks(now: number): SeedLink[] {
  const G = (input: Omit<CreateLinkInput, "tenant">, weight: number, age: number): SeedLink => ({
    input: { tenant: "globex", ...input },
    weight,
    age,
  });
  const I = (input: Omit<CreateLinkInput, "tenant">, weight: number, age: number): SeedLink => ({
    input: { tenant: "initech", ...input },
    weight,
    age,
  });
  return [
    G(
      {
        domain: "glbx.co",
        slug: "hello",
        url: "https://globex.com",
        title: "Homepage",
        tags: ["brand"],
      },
      6,
      88,
    ),
    G(
      {
        domain: "glbx.co",
        slug: "demo",
        url: "https://globex.com/demo",
        title: "Book a demo",
        tags: ["sales"],
        trackConversions: true,
      },
      5,
      60,
    ),
    G(
      {
        domain: "glbx.co",
        slug: "ebook",
        url: "https://globex.com/resources/ebook",
        title: "E-book download",
        tags: ["content"],
        utm: { source: "linkedin", medium: "paid" },
      },
      4,
      40,
    ),
    G(
      {
        domain: "glbx.co",
        slug: "summit",
        url: "https://globex.com/summit-2026",
        title: "Globex Summit",
        tags: ["events"],
        expiresAt: new Date(now + 30 * DAY).toISOString(),
      },
      3,
      25,
    ),
    G(
      {
        domain: "glbx.co",
        slug: "jobs",
        url: "https://globex.com/careers",
        title: "Careers",
        tags: ["hiring"],
      },
      2,
      70,
    ),
    G(
      {
        domain: "lnks.dev",
        url: "https://globex.com/changelog",
        title: "Changelog",
        tags: ["product"],
      },
      2,
      30,
    ),
    G(
      {
        domain: "glbx.co",
        slug: "trial",
        url: "https://app.globex.com/signup",
        title: "Free trial",
        tags: ["sales"],
        trackConversions: true,
        rules: [
          {
            name: "Enterprise visitors",
            when: [{ field: "query", key: "plan", op: "in", values: ["enterprise"] }],
            url: "https://globex.com/enterprise",
          },
        ],
      },
      4,
      55,
    ),
    G(
      {
        domain: "glbx.co",
        slug: "press",
        url: "https://globex.com/press",
        title: "Press kit",
        tags: ["brand"],
      },
      1,
      80,
    ),
    I(
      {
        domain: "lnks.dev",
        url: "https://initech.com/tps",
        title: "TPS report template",
        tags: ["docs"],
      },
      3,
      70,
    ),
    I(
      {
        domain: "lnks.dev",
        url: "https://initech.com/office-space",
        title: "Office tour",
        tags: ["hiring"],
      },
      2,
      45,
    ),
    I(
      {
        domain: "lnks.dev",
        slug: "initech-q4",
        url: "https://initech.com/q4",
        title: "Q4 all-hands",
        tags: ["internal"],
        password: "flair",
      },
      1,
      20,
    ),
    I(
      {
        domain: "lnks.dev",
        url: "https://initech.com/stapler",
        title: "Red stapler giveaway",
        tags: ["campaign"],
        utm: { source: "newsletter", medium: "email", campaign: "stapler" },
      },
      2,
      15,
    ),
  ];
}

const COUNTRIES: Weighted<[string, string, string[]]> = [
  [["US", "NA", ["New York", "San Francisco", "Austin", "Chicago", "Seattle"]], 34],
  [["DE", "EU", ["Berlin", "Munich", "Hamburg"]], 13],
  [["GB", "EU", ["London", "Manchester"]], 10],
  [["BR", "SA", ["São Paulo", "Rio de Janeiro"]], 6],
  [["IN", "AS", ["Bengaluru", "Mumbai"]], 6],
  [["FR", "EU", ["Paris", "Lyon"]], 5],
  [["CA", "NA", ["Toronto", "Vancouver"]], 5],
  [["NL", "EU", ["Amsterdam"]], 3],
  [["JP", "AS", ["Tokyo", "Osaka"]], 3],
  [["ES", "EU", ["Madrid", "Barcelona"]], 3],
  [["AU", "OC", ["Sydney", "Melbourne"]], 3],
  [["MX", "NA", ["Mexico City"]], 2],
  [["CO", "SA", ["Medellín", "Bogotá"]], 2],
  [["AT", "EU", ["Vienna"]], 2],
  [["SE", "EU", ["Stockholm"]], 1],
  [["NG", "AF", ["Lagos"]], 1],
  [["SG", "AS", ["Singapore"]], 1],
];

const PLATFORMS: Weighted<[DeviceType, string, Weighted<string>]> = [
  [
    [
      "mobile",
      "ios",
      [
        ["safari", 75],
        ["chrome", 20],
        ["instagram", 5],
      ],
    ],
    30,
  ],
  [
    [
      "mobile",
      "android",
      [
        ["chrome", 80],
        ["samsung", 15],
        ["firefox", 5],
      ],
    ],
    22,
  ],
  [
    [
      "desktop",
      "macos",
      [
        ["chrome", 55],
        ["safari", 35],
        ["firefox", 10],
      ],
    ],
    21,
  ],
  [
    [
      "desktop",
      "windows",
      [
        ["chrome", 70],
        ["edge", 25],
        ["firefox", 5],
      ],
    ],
    19,
  ],
  [
    [
      "desktop",
      "linux",
      [
        ["firefox", 55],
        ["chrome", 45],
      ],
    ],
    4,
  ],
  [["tablet", "ios", [["safari", 100]]], 3],
  [["tablet", "android", [["chrome", 100]]], 1],
];

const REFERRERS: Weighted<string> = [
  ["(direct)", 30],
  ["t.co", 12],
  ["www.google.com", 12],
  ["www.linkedin.com", 9],
  ["l.instagram.com", 7],
  ["news.ycombinator.com", 6],
  ["mail.google.com", 6],
  ["www.facebook.com", 5],
  ["github.com", 4],
  ["www.reddit.com", 4],
  ["slack.com", 3],
  ["duckduckgo.com", 2],
];

const LANGUAGES: Record<string, string> = {
  US: "en",
  GB: "en",
  CA: "en",
  AU: "en",
  IN: "en",
  NG: "en",
  SG: "en",
  DE: "de",
  AT: "de",
  FR: "fr",
  ES: "es",
  MX: "es",
  CO: "es",
  BR: "pt",
  NL: "nl",
  JP: "ja",
  SE: "sv",
};

const FIRST = [
  "Ada",
  "Grace",
  "Linus",
  "Margaret",
  "Alan",
  "Barbara",
  "Ken",
  "Radia",
  "Dennis",
  "Frances",
  "Tim",
  "Hedy",
  "Guido",
  "Anita",
  "Bjarne",
  "Sophie",
  "Yukihiro",
  "Mary",
  "James",
  "Karen",
];
const LAST = [
  "Lovelace",
  "Hopper",
  "Torvalds",
  "Hamilton",
  "Turing",
  "Liskov",
  "Thompson",
  "Perlman",
  "Ritchie",
  "Allen",
  "Berners-Lee",
  "Lamarr",
  "van Rossum",
  "Borg",
  "Stroustrup",
  "Wilson",
  "Matsumoto",
  "Shaw",
  "Gosling",
  "Jones",
];

/** Seed the demo dataset into `core`. Idempotent-ish: run it once per fresh storage. */
export async function seedDemo(
  core: LinksCore,
  options: SeedDemoOptions = {},
): Promise<SeedDemoResult> {
  const now = options.now ?? Date.now();
  const random = prng(options.seed ?? 42);
  const pick = picker(random);
  const clock = options.clock ?? (() => {});
  const actor = { id: "usr_demo", name: "Dana Admin", email: "dana@acme.com" };
  const weightById = new Map<string, number>();
  /** Intended creation time per link (traffic starts after it, even without a clock). */
  const bornById = new Map<string, number>();
  const ids: Partial<SeedDemoResult["ids"]> = {};

  try {
    // Tenants + domains, created three months ago.
    clock(now - 92 * DAY);
    await core.upsertTenant(
      { key: "acme", name: "Acme Inc", metadata: { plan: "business" } },
      { actor },
    );
    await core.upsertTenant(
      { key: "globex", name: "Globex Corporation", metadata: { plan: "pro" } },
      { actor },
    );
    await core.upsertTenant(
      { key: "initech", name: "Initech", metadata: { plan: "free" } },
      { actor },
    );
    for (const d of DOMAINS) await core.createDomain(d, { actor });

    // Links, each at its own creation time.
    const seeds = [...acmeLinks(now), ...otherLinks(now)].sort((a, b) => b.age - a.age);
    const created: { id: string; slug: string }[] = [];
    for (const seed of seeds) {
      const born = now - seed.age * DAY + Math.floor(random() * 6 * HOUR);
      clock(born);
      const link = await core.createLink(seed.input, { actor });
      bornById.set(link.id, born);
      if (seed.key) ids[seed.key] = link.id;
      weightById.set(link.id, seed.weight);
      created.push({ id: link.id, slug: link.slug });
    }
    // A couple of edits so the audit log has more than creations.
    clock(now - 3 * DAY);
    const spring = created.find((c) => c.slug === "spring");
    if (spring)
      await core.updateLink(
        "acme",
        spring.id,
        { tags: ["campaign", "sale", "featured"] },
        { actor },
      );
    clock(now - 2 * HOUR);
    const careers = created.find((c) => c.slug === "careers");
    if (careers)
      await core.updateLink(
        "acme",
        careers.id,
        { title: "We're hiring — 12 open roles" },
        { actor },
      );
  } finally {
    clock(undefined);
  }

  // Synthetic traffic, ingested through the sink like the redirect handler would.
  const all = (
    await Promise.all(
      ["acme", "globex", "initech"].map(
        async (t) => (await core.listLinks(t, { archived: "all", limit: 500 })).links,
      ),
    )
  ).flat();
  const byId = new Map(all.map((l) => [l.id, l]));
  const tenantShare: Weighted<string> = [
    ["acme", 72],
    ["globex", 20],
    ["initech", 8],
  ];
  const total = options.clicks ?? 5000;
  const events: ClickEvent[] = [];
  const leads: { tenant: string; clickId: string; at: number; linkId: string }[] = [];
  const visitorsPerDay = new Map<string, string[]>();

  // Day weights: steady growth, weekday seasonality and two campaign spikes.
  const dayWeights: Weighted<number> = Array.from({ length: 90 }, (_, d) => {
    const daysAgo = 89 - d;
    const t = now - daysAgo * DAY;
    const dow = new Date(t).getUTCDay();
    const growth = 0.55 + (d / 89) * 0.9;
    const weekday = dow === 0 || dow === 6 ? 0.68 : 1;
    const spike = daysAgo === 12 || daysAgo === 11 ? 2.6 : daysAgo === 40 ? 1.9 : 1;
    return [daysAgo, growth * weekday * spike] as const;
  });
  const hourWeights: Weighted<number> = Array.from(
    { length: 24 },
    (_, h) => [h, 0.25 + Math.exp(-((h - 15) ** 2) / 30)] as const,
  );

  for (let i = 0; i < total; i++) {
    const tenant = pick(tenantShare);
    const daysAgo = pick(dayWeights);
    const dayStart = Math.floor((now - daysAgo * DAY) / DAY) * DAY;
    let at = dayStart + pick(hourWeights) * HOUR + Math.floor(random() * HOUR);
    if (at > now) at = now - Math.floor(random() * HOUR);
    const candidates = all.filter((l) => l.tenant === tenant && (bornById.get(l.id) ?? 0) < at);
    if (!candidates.length) continue;
    const link = pick(candidates.map((l) => [l, weightById.get(l.id) ?? 1] as const));
    const [country, continent, cities] = pick(COUNTRIES);
    const [device, os, browsers] = pick(PLATFORMS);
    const browser = pick(browsers);
    const qr = link.slug === "qr-store" ? random() < 0.7 : random() < 0.06;
    const referrerHost = qr ? "(direct)" : pick(REFERRERS);
    const bot = random() < 0.035;
    const dayKey = `${tenant}:${dayStart}`;
    const pool = visitorsPerDay.get(dayKey) ?? [];
    let visitor: string;
    if (pool.length && random() < 0.28) visitor = pool[Math.floor(random() * pool.length)]!;
    else {
      visitor = `v${Math.floor(random() * 1e12).toString(36)}`;
      pool.push(visitor);
      visitorsPerDay.set(dayKey, pool);
    }
    const variants = link.rules.flatMap((r) =>
      (r.variants ?? []).map((v, j) => ({ id: v.id ?? String(j), weight: v.weight })),
    );
    const variant = variants.length
      ? pick(variants.map((v) => [v.id, v.weight] as const))
      : undefined;
    const event: ClickEvent = {
      type: "click",
      id: newId("clk", at),
      at: new Date(at).toISOString(),
      tenant,
      linkId: link.id,
      domain: link.domain,
      slug: link.slug,
      destination: link.url,
      ...(variant ? { variant, ruleId: link.rules[0]!.id } : {}),
      country,
      continent,
      city: cities[Math.floor(random() * cities.length)]!,
      device: bot ? "bot" : device,
      os,
      browser,
      language: LANGUAGES[country] ?? "en",
      ...(referrerHost !== "(direct)" ? { referrer: `https://${referrerHost}/` } : {}),
      referrerHost,
      visitor,
      bot,
      qr,
      ...(link.utm ? { utm: link.utm } : {}),
    };
    events.push(event);
    if (!bot) core.countClick(tenant, link.id);
    // Leads on conversion-tracked links: ~6% of human clicks within the attribution window.
    const leadRate = variant === "b" ? 0.09 : 0.06;
    if (!bot && link.trackConversions && random() < leadRate && now - at < 80 * DAY) {
      leads.push({ tenant, clickId: event.id, at, linkId: link.id });
    }
  }
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (let i = 0; i < events.length; i += 500)
    await core.analytics.ingest(events.slice(i, i + 500));
  await core.flushCounters();

  // Conversions through the real attribution path: click ref → lead → sales.
  let leadCount = 0;
  let saleCount = 0;
  for (const [n, lead] of leads.entries()) {
    const link = byId.get(lead.linkId)!;
    await core.recordClickRef({
      clickId: lead.clickId,
      tenant: lead.tenant,
      linkId: lead.linkId,
      domain: link.domain,
      slug: link.slug,
      at: new Date(lead.at).toISOString(),
    });
    const first = FIRST[n % FIRST.length]!;
    const last = LAST[Math.floor(n / FIRST.length + n) % LAST.length]!;
    const customerId = `cus_${(1000 + n).toString(36)}${Math.floor(random() * 1e6).toString(36)}`;
    const leadAt = lead.at + Math.floor(random() * 2 * HOUR);
    const result = await core.trackLead({
      tenant: lead.tenant,
      clickId: lead.clickId,
      customerId,
      customerName: `${first} ${last}`,
      customerEmail: `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "") + "@example.com",
      name:
        link.slug === "app" ? "App install" : link.slug === "newsletter" ? "Subscribed" : "Sign up",
      at: new Date(Math.min(leadAt, now)).toISOString(),
    });
    if (!result) continue;
    leadCount++;
    // ~35% buy, some more than once.
    const purchases = random() < 0.35 ? (random() < 0.25 ? 2 : 1) : 0;
    for (let p = 0; p < purchases; p++) {
      const saleAt = Math.min(
        leadAt + Math.floor((0.2 + random() * 6) * DAY) * (p + 1),
        now - 5 * 60_000,
      );
      const amount = [1900, 4900, 4900, 9900, 12900, 2900, 19900][Math.floor(random() * 7)]!;
      const sale = await core.trackSale({
        tenant: lead.tenant,
        customerId,
        amount,
        currency: "USD",
        name: "Purchase",
        invoiceId: `inv_${saleCount + 1}`,
        at: new Date(saleAt).toISOString(),
      });
      if (sale) saleCount++;
    }
  }

  return {
    tenants: ["acme", "globex", "initech"],
    links: all.length,
    clicks: events.length,
    leads: leadCount,
    sales: saleCount,
    ids: ids as SeedDemoResult["ids"],
  };
}

if (import.meta.main) {
  const { createLinksCore } = await import("../src/core.ts");
  const { createMemoryStorage } = await import("../src/storage/memory.ts");
  const { createMemoryAnalytics } = await import("../src/analytics/memory.ts");
  const core = createLinksCore({
    storage: createMemoryStorage(),
    analytics: createMemoryAnalytics(),
  });
  const result = await seedDemo(core);
  console.log(JSON.stringify(result, null, 2));
  await core.close();
}
