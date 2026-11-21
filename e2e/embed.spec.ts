import { expect, test, type Locator, type Page } from "@playwright/test";

// The React embeds on a themed host page (scripts/demo-app.ts → /e2e/embed,
// mounting the built dist/react.js + scoped dist/react.css). The widget
// (<LinkAnalytics>, viewer token) is the default mode; theme behaviour mirrors
// the sibling packages: inherit follows the host live, auto has its own
// switcher, light/dark force — and the embed never writes to the host document.

const HEADING = "Analytics";

const wrapper = (page: Page): Locator => page.locator(".xtandard-links");
const themeToggle = (page: Page): Locator => page.getByRole("group", { name: "Theme" });

/** WCAG relative luminance of a computed CSS color (any syntax, incl. oklch). */
async function luminance(locator: Locator, prop: "color" | "background-color"): Promise<number> {
  return locator.evaluate((el, p) => {
    const value = getComputedStyle(el).getPropertyValue(p);
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data).map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  }, prop);
}

const contrast = (a: number, b: number): number =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * Assert the panel renders as one `theme`: its own surfaces (wrapper + cards)
 * and a title readable on them. Visual checks first — they are the user-facing
 * symptom — then the wrapper's `data-theme`.
 */
async function expectPanelTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  const heading = page.getByRole("heading", { name: HEADING });
  await expect(heading).toBeVisible();

  await expect
    .poll(async () => {
      const surface = await luminance(wrapper(page), "background-color");
      const card = await luminance(
        page.locator(".xtandard-links .bg-card").first(),
        "background-color",
      );
      const text = await luminance(heading, "color");
      return {
        surface: theme === "dark" ? surface < 0.05 : surface > 0.8,
        card: theme === "dark" ? card < 0.05 : card > 0.8,
        // Text and surfaces from one theme: the title is readable on both.
        titleOnSurface: contrast(text, surface) > 7,
        titleOnCard: contrast(text, card) > 7,
      };
    })
    .toEqual({ surface: true, card: true, titleOnSurface: true, titleOnCard: true });

  await expect(wrapper(page)).toHaveAttribute("data-theme", theme);
}

test.describe("theme=inherit", () => {
  test.use({ colorScheme: "light" }); // OS preference differs from the host's theme

  test("follows a class-based dark host, live, without a toggle", async ({ page }) => {
    await page.goto("/e2e/embed?theme=inherit&host=class");
    await expectPanelTheme(page, "dark");
    await expect(themeToggle(page)).toHaveCount(0);
    // The embed never writes to the host document.
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);

    // Host switches to light → the panel follows.
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
    await expectPanelTheme(page, "light");
    // …and back.
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await expectPanelTheme(page, "dark");
  });

  test("follows a data-theme host", async ({ page }) => {
    await page.goto("/e2e/embed?theme=inherit&host=attr");
    await expectPanelTheme(page, "dark");
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await expectPanelTheme(page, "light");
  });
});

test.describe("theme=inherit without a host marker", () => {
  test.use({ colorScheme: "dark" });

  test("falls back to prefers-color-scheme", async ({ page }) => {
    await page.goto("/e2e/embed?theme=inherit");
    await expectPanelTheme(page, "dark");
  });
});

test.describe("theme=auto", () => {
  test.use({ colorScheme: "light" });

  test("the panel's switcher themes the panel only", async ({ page }) => {
    await page.goto("/e2e/embed?theme=auto");
    await page.evaluate(() => localStorage.removeItem("xtandard-links:theme"));
    await page.reload();
    await expectPanelTheme(page, "light");
    await page.getByRole("button", { name: "Dark theme" }).click();
    await expectPanelTheme(page, "dark");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
    await page.getByRole("button", { name: "Light theme" }).click();
    await expectPanelTheme(page, "light");
  });
});

test.describe("forced themes", () => {
  test.use({ colorScheme: "light" });

  test("theme=light stays light and readable on a dark host", async ({ page }) => {
    await page.goto("/e2e/embed?theme=light&host=class");
    await expectPanelTheme(page, "light");
    await expect(themeToggle(page)).toHaveCount(0);
  });

  test("theme=dark stays dark on a light host", async ({ page }) => {
    await page.goto("/e2e/embed?theme=dark");
    await expectPanelTheme(page, "dark");
  });
});

test.describe("widget scope", () => {
  test("renders the viewer chrome inside the host, scoped CSS only", async ({ page }) => {
    await page.goto("/e2e/embed?theme=light");
    await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
    await expect(page.getByText("Viewer", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Tenant")).toHaveCount(0);
    await expect(page.getByTestId("kpi-clicks")).not.toHaveText("0");
    // The host's own heading keeps the host font (preflight is scoped to the embed).
    const hostFont = await page
      .locator(".host-heading")
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(hostFont).toMatch(/system-ui/);
    // Popups portal into the scoped wrapper.
    await page.getByRole("button", { name: "Last 7 days" }).click();
    await expect(page.getByRole("button", { name: "Last 7 days" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("the dashboard embed routes in memory without touching the host URL", async ({ page }) => {
    await page.goto("/e2e/embed?mode=dashboard&theme=light");
    await expect(page.getByRole("heading", { name: "Links" })).toBeVisible();
    await page.getByRole("button", { name: "Analytics", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/e2e/embed");
    expect(new URL(page.url()).hash).toBe("");
  });
});
