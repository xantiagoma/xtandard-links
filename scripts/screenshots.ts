/**
 * README / docs screenshots of the admin UI, the viewer widget and the React
 * embed, taken from the seeded demo app (scripts/demo-app.ts) with Playwright.
 *
 *   bun run build:ui && bun run build:react && bun scripts/screenshots.ts
 *   bun scripts/screenshots.ts ui-analytics   # only shots whose name contains it
 *
 * Writes docs/assets/ui-*.png at 1440×900 (rendered at 2× and downscaled to
 * 1× retina-crisp PNGs), then runs `oxipng` when it is installed.
 *
 * @module
 */

import { chromium, type Page } from "playwright";
import { createDemoApp, PANEL_BASE } from "./demo-app.ts";

const OUT = new URL("../docs/assets/", import.meta.url).pathname;
const filter = process.argv[2];

const app = await createDemoApp({ title: "Acme Links" });
const server = Bun.serve({ port: 0, fetch: (request) => app.fetch(request) });
const base = `http://localhost:${server.port}`;
const ids = app.seeded.ids;

interface Shot {
  name: string;
  theme: "light" | "dark";
  /** Navigate and prepare the page. */
  run(page: Page): Promise<void>;
  /** Capture the full scrollable page instead of the viewport. */
  fullPage?: boolean;
}

const panel = (path: string) => `${base}${PANEL_BASE}${path}`;

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}

const shots: Shot[] = [
  {
    name: "ui-links",
    theme: "light",
    async run(page) {
      await page.goto(panel("/?tenant=acme"));
      await page.getByTestId("link-row").first().waitFor();
      await settle(page);
    },
  },
  {
    name: "ui-link-detail",
    theme: "light",
    async run(page) {
      await page.goto(panel(`/links/${ids.spring}?tenant=acme`));
      await page.getByTestId("kpi-clicks").waitFor();
      await settle(page);
    },
  },
  {
    name: "ui-analytics",
    theme: "light",
    async run(page) {
      await page.goto(panel("/analytics?tenant=acme"));
      await page.getByTestId("kpi-clicks").waitFor();
      await settle(page);
    },
  },
  {
    name: "ui-analytics-dark",
    theme: "dark",
    async run(page) {
      await page.goto(panel("/analytics?tenant=acme&range=90d"));
      await page.getByTestId("kpi-clicks").waitFor();
      await settle(page);
    },
  },
  {
    name: "ui-link-editor",
    theme: "light",
    async run(page) {
      await page.goto(panel(`/links/${ids.spring}?tenant=acme`));
      await page.getByRole("button", { name: "Edit rules" }).click();
      await page.getByTestId("rule-card").first().waitFor();
      await settle(page);
    },
  },
  {
    name: "ui-link-editor-dark",
    theme: "dark",
    async run(page) {
      await page.goto(panel(`/links/${ids.abTest}?tenant=acme`));
      await page.getByRole("button", { name: "Edit rules" }).click();
      await page.getByTestId("rule-variant").first().waitFor();
      await settle(page);
    },
  },
  {
    name: "ui-domains",
    theme: "light",
    async run(page) {
      await page.goto(panel("/domains?tenant=acme"));
      await page.getByTestId("domain-card").first().waitFor();
      await settle(page);
    },
  },
  {
    name: "ui-import",
    theme: "light",
    async run(page) {
      await page.goto(panel("/import?tenant=acme"));
      await page.getByRole("button", { name: "Use sample" }).click();
      await page.getByRole("button", { name: "Preview (dry run)" }).click();
      await page.getByTestId("import-result").waitFor();
      await settle(page);
    },
  },
  {
    name: "ui-widget",
    theme: "light",
    async run(page) {
      const res = await fetch(`${base}/e2e/viewer-token?tenant=acme`);
      const { token } = (await res.json()) as { token: string };
      await page.goto(panel(`/?token=${token}`));
      await page.getByTestId("kpi-clicks").waitFor();
      await settle(page);
    },
  },
  {
    name: "ui-react-embed",
    theme: "light",
    async run(page) {
      await page.goto(`${base}/e2e/embed?mode=widget&theme=light`);
      await page.getByTestId("kpi-clicks").waitFor();
      await settle(page);
    },
  },
];

const browser = await chromium.launch();
try {
  for (const shot of shots) {
    if (filter && !shot.name.includes(filter)) continue;
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: shot.theme,
    });
    await context.addInitScript((theme) => {
      try {
        localStorage.setItem("xtandard-links:theme", theme);
      } catch {
        /* ignore */
      }
    }, shot.theme);
    const page = await context.newPage();
    await shot.run(page);
    const raw = `${OUT}${shot.name}@2x.png`;
    await page.screenshot({ path: raw, fullPage: shot.fullPage ?? false });
    await context.close();
    // Downscale 2× → 1440 px wide (crisp text, reasonable file size).
    const out = `${OUT}${shot.name}.png`;
    const magick = Bun.which("magick");
    if (magick) {
      await Bun.$`${magick} ${raw} -filter Lanczos -resize 50% -strip ${out}`.quiet();
      await Bun.$`rm -f ${raw}`.quiet();
    } else {
      await Bun.$`mv ${raw} ${out}`.quiet();
    }
    if (Bun.which("oxipng")) await Bun.$`oxipng -o 3 --strip safe -q ${out}`.quiet();
    console.log(`✓ ${shot.name}.png`);
  }
} finally {
  await browser.close();
  server.stop(true);
  await app.close();
}
