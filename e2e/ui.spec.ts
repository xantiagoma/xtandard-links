import { expect, test, type Page } from "@playwright/test";

// Runs against the seeded in-memory demo app (see playwright.config.ts and
// scripts/demo-app.ts): the panel at /links, short links on the same port
// (resolved by X-Forwarded-Host). Serial: later tests reuse what earlier ones
// created.
test.describe.configure({ mode: "serial" });

const panel = (path = "/") => `/links${path}`;
const SLUG = "e2e-launch";

async function viewerToken(page: Page, query = "tenant=acme"): Promise<string> {
  const res = await page.request.get(`/e2e/viewer-token?${query}`);
  return ((await res.json()) as { token: string }).token;
}

test("loads the links list for the first tenant", async ({ page }) => {
  await page.goto(panel("/"));
  await expect(page.getByText("@xtandard/links e2e").first()).toBeVisible();
  await expect(page.getByLabel("Tenant")).toHaveText(/acme/);
  await expect(page.getByRole("heading", { name: "Links" })).toBeVisible();
  await expect(page.getByTestId("link-row").first()).toBeVisible();
  expect(await page.getByTestId("link-row").count()).toBeGreaterThan(15);
  // Archived links are hidden by default.
  await expect(page.getByText("holiday-2025")).toHaveCount(0);
});

test("searches and filters by tag", async ({ page }) => {
  await page.goto(panel("/?tenant=acme"));
  await page.getByLabel("Search links").fill("spring");
  await expect(page.getByTestId("link-row")).toHaveCount(1);
  await expect(page.getByTestId("link-row").first()).toContainText("go.acme.com/spring");
  await expect(page).toHaveURL(/q=spring/);

  await page.getByLabel("Search links").fill("");
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(page.getByTestId("link-row").first()).toContainText("holiday-2025");
});

test("switches tenants from the combobox", async ({ page }) => {
  await page.goto(panel("/"));
  await page.getByLabel("Tenant").click();
  await page.getByRole("option", { name: "globex" }).click();
  await expect(page).toHaveURL(/tenant=globex/);
  await expect(page.getByTestId("link-row").first()).toContainText("glbx.co");
});

test("creates a link with a geo rule and the redirect honours it", async ({ page, request }) => {
  await page.goto(panel("/?tenant=acme"));
  await page.getByRole("button", { name: "New link" }).click();
  await page
    .getByLabel("Destination URL")
    .fill("https://acme.com/launch?utm_source=e2e&utm_medium=test");
  await page.getByLabel("Slug", { exact: true }).fill(SLUG);
  // Pasted utm_ params move into the UTM builder.
  await page.getByLabel("Title").click();
  await expect(page.getByLabel("Destination URL")).toHaveValue("https://acme.com/launch");
  await page.getByLabel("Tags").fill("e2e");
  await page.getByLabel("Tags").press("Enter");
  await expect(page.getByTestId("short-preview")).toHaveText(`go.acme.com/${SLUG}`);

  await page.getByRole("button", { name: "UTM" }).click();
  await expect(page.getByLabel("utm_source")).toHaveValue("e2e");

  await page.getByRole("button", { name: /^Rules/ }).click();
  await page.getByRole("button", { name: "Geo rule" }).click();
  await page.getByLabel("Country values").fill("de");
  await page.getByLabel("Country values").press("Enter");
  await page.getByLabel("Rule 1 destination").fill("https://acme.com/de/launch");
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByText("Link created")).toBeVisible();

  const plain = await request.get(`/${SLUG}`, {
    headers: { "x-forwarded-host": "go.acme.com" },
    maxRedirects: 0,
  });
  expect(plain.status()).toBe(302);
  expect(plain.headers().location).toMatch(/^https:\/\/acme\.com\/launch\?.*utm_source=e2e/);

  const german = await request.get(`/${SLUG}`, {
    headers: { "x-forwarded-host": "go.acme.com", "cf-ipcountry": "DE" },
    maxRedirects: 0,
  });
  expect(german.status()).toBe(302);
  expect(german.headers().location).toMatch(/^https:\/\/acme\.com\/de\/launch/);
});

test("rule validation blocks saving an incomplete rule", async ({ page }) => {
  await page.goto(panel("/?tenant=acme"));
  await page.getByRole("button", { name: "New link" }).click();
  await page.getByLabel("Destination URL").fill("https://acme.com/x");
  await page.getByRole("button", { name: /^Rules/ }).click();
  await page.getByRole("button", { name: "Device rule" }).click();
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByText("OS condition needs a value")).toBeVisible();
  await expect(page.getByText("Destination must be a valid URL")).toBeVisible();
  // Closing with edits asks before discarding.
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("button", { name: "Create link" })).toHaveCount(0);
});

test("link detail shows analytics, QR and rules", async ({ page }) => {
  await page.goto(panel("/?tenant=acme"));
  await page.getByLabel("Search links").fill("spring");
  await expect(page.getByTestId("link-row")).toHaveCount(1);
  await page.getByTestId("link-row").first().click();
  await expect(page.getByRole("heading", { name: "go.acme.com/spring" })).toBeVisible();
  await expect(page.getByTestId("qr-image")).toBeVisible();
  await expect(page.getByText("Country is Germany or Austria")).toBeVisible();
  await expect
    .poll(async () =>
      Number((await page.getByTestId("kpi-clicks").textContent())?.replace(/\D/g, "") || 0),
    )
    .toBeGreaterThan(0);
  await expect(page.getByText("Recent activity")).toBeVisible();
  await expect(page.getByRole("img", { name: /Clicks over time/ })).toBeVisible();
});

test("tenant analytics: ranges, metrics and click-to-filter", async ({ page }) => {
  await page.goto(panel("/analytics?tenant=acme"));
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
  const kpi = async () =>
    Number((await page.getByTestId("kpi-clicks").textContent())?.replace(/\D/g, "") || 0);
  await expect.poll(kpi).toBeGreaterThan(100);
  const total30 = await kpi();

  await page.getByRole("button", { name: "Last 90 days" }).click();
  await expect(page).toHaveURL(/range=90d/);
  await expect.poll(kpi).toBeGreaterThan(total30);
  const total90 = await kpi();

  // Uniques come from the memory sink's capabilities.
  await expect(page.getByTestId("kpi-uniques")).toBeVisible();
  await page.getByTestId("kpi-leads").click();
  await expect(page).toHaveURL(/metric=leads/);

  // Clicking a breakdown row filters everything by it.
  await page.getByTestId("kpi-clicks").click();
  await page.getByRole("button", { name: /^Filter by Germany/ }).click();
  await expect(page).toHaveURL(/filters=country%3ADE|filters=country:DE/);
  await expect(page.getByRole("button", { name: "Clear Country filter" })).toBeVisible();
  // Germany is a slice of the total; conversions are not split by visitor filters.
  await expect.poll(kpi).toBeLessThan(total90);
  expect(await kpi()).toBeGreaterThan(0);
  await expect(page.getByTestId("kpi-leads")).toHaveText("—");
  await page.getByRole("button", { name: "Clear Country filter" }).click();
  await expect(page).not.toHaveURL(/filters=/);
});

test("adds, edits and removes a branded domain", async ({ page }) => {
  await page.goto(panel("/domains?tenant=acme"));
  await expect(page.getByTestId("domain-card").first()).toBeVisible();
  await expect(page.getByText("go.acme.com", { exact: true })).toBeVisible();
  await expect(page.getByText("iOS app").first()).toBeVisible();

  await page.getByRole("button", { name: "Add domain" }).click();
  await page.getByLabel("Hostname").fill("e2e.acme.dev");
  await page.getByLabel("Root URL").fill("https://acme.dev");
  await page.getByLabel("iOS app IDs").fill("ABCDE12345.dev.acme.app");
  await page.getByLabel("iOS app IDs").press("Enter");
  await page.getByRole("button", { name: "Add domain" }).last().click();
  await expect(page.getByText("Domain added")).toBeVisible();
  const card = page.getByTestId("domain-card").filter({ hasText: "e2e.acme.dev" });
  await expect(card).toContainText("acme.dev");

  // The new domain serves the app association file.
  const aasa = await page.request.get("/.well-known/apple-app-site-association", {
    headers: { "x-forwarded-host": "e2e.acme.dev" },
  });
  expect(aasa.status()).toBe(200);
  expect(await aasa.text()).toContain("ABCDE12345.dev.acme.app");

  await page.getByRole("button", { name: "Edit e2e.acme.dev" }).click();
  await page.getByLabel("Not-found URL").fill("https://acme.dev/404");
  await page.getByRole("button", { name: "Save domain" }).click();
  await expect(page.getByText("Domain saved")).toBeVisible();
  await expect(card).toContainText("acme.dev/404");

  await page.getByRole("button", { name: "Delete e2e.acme.dev" }).click();
  await page.getByRole("button", { name: "Remove domain" }).click();
  await expect(page.getByText("Domain removed")).toBeVisible();
  await expect(card).toHaveCount(0);
});

test("imports a CSV with a dry-run preview", async ({ page }) => {
  await page.goto(panel("/import?tenant=acme"));
  await page
    .getByLabel("CSV contents")
    .fill(
      "url,slug,title,tags\nhttps://acme.com/e2e-a,e2e-import-a,Imported A,imported\nnot-a-url,e2e-import-b,Broken,\nhttps://acme.com/spring,spring,Dupe,",
    );
  await page.getByRole("button", { name: "Preview (dry run)" }).click();
  const result = page.getByTestId("import-result");
  await expect(result).toContainText("Dry run — nothing was written");
  await expect(result).toContainText("1 to create");
  await expect(result).toContainText("1 skipped");
  await expect(result).toContainText("1 errors");
  await expect(result).toContainText("e2e-import-a");

  await page.getByRole("button", { name: /^Import 3 links$/ }).click();
  await expect(result).toContainText("Import finished");
  await expect(result).toContainText("1 created");

  await page.goto(panel("/?tenant=acme&q=e2e-import"));
  await expect(page.getByTestId("link-row")).toHaveCount(1);
});

test("conversions list attributed customers", async ({ page }) => {
  await page.goto(panel("/customers?tenant=acme"));
  await expect(page.getByRole("heading", { name: "Conversions" })).toBeVisible();
  await expect(page.locator("tbody tr").first()).toBeVisible();
  expect(await page.locator("tbody tr").count()).toBeGreaterThan(10);
});

test("audit log records control-plane changes", async ({ page }) => {
  await page.goto(panel("/audit?tenant=acme"));
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  await expect(page.getByText("link.created").first()).toBeVisible();
  await expect(page.getByText("links.imported").first()).toBeVisible();
});

test("a viewer token renders the reduced widget chrome", async ({ page }) => {
  const token = await viewerToken(page);
  expect(token).toMatch(/^lvt_/);
  await page.goto(panel(`/?token=${token}`));

  await expect(page.getByText("Viewer", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
  await expect(page.getByLabel("Tenant")).toHaveCount(0);
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("button")).toHaveText(["Analytics", "Links"]);
  await expect(page.getByTestId("kpi-clicks")).toHaveText(/[1-9]/);

  // Read-only links: no create/edit/delete affordances.
  await nav.getByRole("button", { name: "Links" }).click();
  await expect(page.getByTestId("link-row").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "New link" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Edit link/ })).toHaveCount(0);
});

test("a link-scoped viewer token with create rights", async ({ page }) => {
  const { links } = (await (
    await page.request.get("/links/api/tenants/acme/links?search=spring")
  ).json()) as {
    links: { id: string }[];
  };
  const token = await viewerToken(
    page,
    `tenant=acme&links=${links[0]!.id}&allow=analytics:read,link:read,link:update`,
  );
  await page.goto(panel(`/links?token=${token}`));
  await expect(page.getByTestId("link-row")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Edit link" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New link" })).toHaveCount(0);
});

test("an expired viewer token is refused", async ({ page }) => {
  const token = await viewerToken(page, "tenant=acme&expiresIn=1ms");
  await page.waitForTimeout(50);
  await page.goto(panel(`/?token=${token}`));
  await expect(page.getByText(/not authorized|expired|Invalid/i).first()).toBeVisible();
});

test("password-protected links ask for the password", async ({ request }) => {
  const res = await request.get("/investors", {
    headers: { "x-forwarded-host": "go.acme.com" },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain("Password required");
});
