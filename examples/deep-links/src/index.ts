/**
 * Deep links end to end, in one script (no server):
 *
 *   register iOS + Android apps on a domain
 *     → the OS fetches the association files (AASA / assetlinks.json)
 *     → an iPhone without the app clicks a link → the App Store
 *     → an Android phone clicks → Play Store, with the click id as install referrer
 *     → the freshly installed app claims the original destination (deferred deep link).
 *
 *   bun run src/index.ts
 */
import { clickRequest, createTestLinks, USER_AGENTS } from "@xtandard/links/testing";

const { core, redirects, flush } = createTestLinks();

// 1. The domain carries the app associations.
await core.createDomain({
  hostname: "go.acme.com",
  isDefault: true,
  apps: {
    ios: { appIds: ["ABCDE12345.com.acme.app"], paths: ["/p/*"] },
    android: [
      {
        packageName: "com.acme.app",
        sha256CertFingerprints: [
          "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5",
        ],
      },
    ],
  },
});

// 2. The OS fetches the association files from the short domain.
const aasa = await redirects.fetch(
  new Request("https://go.acme.com/.well-known/apple-app-site-association"),
);
console.log("1. AASA         ", JSON.stringify(await aasa.json()));
const assetlinks = await redirects.fetch(
  new Request("https://go.acme.com/.well-known/assetlinks.json"),
);
console.log("   assetlinks   ", JSON.stringify(await assetlinks.json()));

// 3. A product link: web URL, store fallbacks, and an in-app path to hand over after install.
const link = await core.createLink({
  domain: "go.acme.com",
  slug: "p/42",
  url: "https://acme.com/product/42",
  ios: "https://apps.apple.com/app/id123456789",
  android: "https://play.google.com/store/apps/details?id=com.acme.app",
  deepLink: { path: "/product/42", deferred: true },
});

// 4. Clicks. (With the app installed, iOS/Android open the app directly via the
//    association files and the request never reaches us.)
const ip = "198.51.100.23"; // the same phone on the same network, before and after install
const desktop = await redirects.fetch(clickRequest("https://go.acme.com/p/42"));
console.log("2. desktop      ", desktop.status, desktop.headers.get("location"));
const iphone = await redirects.fetch(
  clickRequest("https://go.acme.com/p/42", { userAgent: USER_AGENTS.iphone, ip }),
);
console.log("3. iPhone       ", iphone.status, iphone.headers.get("location"));
const android = await redirects.fetch(
  clickRequest("https://go.acme.com/p/42", { userAgent: USER_AGENTS.android, ip: "198.51.100.99" }),
);
console.log("4. Android      ", android.status, android.headers.get("location"));
await flush(); // deferred handoffs are stored in the background

// 5. First open after install. Android reads the install referrer and claims
//    exactly by click id; iOS has none, so it claims by a privacy-preserving
//    fingerprint (daily-salted hash of IP + OS) of the same request shape.
const referrer = new URL(android.headers.get("location")!).searchParams.get("referrer") ?? "";
const androidClickId = new URLSearchParams(referrer).get("xl_id");
const exact = await redirects.fetch(
  new Request("https://go.acme.com/_links/deferred/claim", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": USER_AGENTS.android },
    body: JSON.stringify({ clickId: androidClickId }),
  }),
);
console.log("5. Android claim", exact.status, JSON.stringify(await exact.json()));

const probabilistic = await redirects.fetch(
  new Request("https://go.acme.com/_links/deferred/claim", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": USER_AGENTS.iphone,
      "x-real-ip": ip,
    },
    body: "{}",
  }),
);
console.log("6. iOS claim    ", probabilistic.status, JSON.stringify(await probabilistic.json()));

// A handoff is claimable once.
const again = await redirects.fetch(
  new Request("https://go.acme.com/_links/deferred/claim", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": USER_AGENTS.iphone,
      "x-real-ip": ip,
    },
    body: "{}",
  }),
);
console.log("7. claim again  ", again.status, JSON.stringify(await again.json()));
console.log(`\nlink ${link.id}: ${await core.getClickCount(link.tenant, link.id)} clicks`);
