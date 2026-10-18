import { test, expect } from "@playwright/test";

test.describe("DEMO: Landing & Public Pages", () => {
  test("landing page and navigation", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);

    // Show landing page
    await expect(page.getByText(/aura/i).first()).toBeVisible();
    await page.waitForTimeout(1500);

    // Scroll down to see features
    await page.evaluate(() => window.scrollTo({ top: 500, behavior: "smooth" }));
    await page.waitForTimeout(2000);

    // Show more sections
    await page.evaluate(() => window.scrollTo({ top: 1000, behavior: "smooth" }));
    await page.waitForTimeout(2000);
  });

  test("resident login page", async ({ page }) => {
    await page.goto("/login");
    await page.waitForTimeout(2000);

    // Show login form
    await expect(page.locator("input[type='email']").first()).toBeVisible();
    await page.waitForTimeout(2000);
  });

  test("ops portal shows role choice (Admin/Staff)", async ({ page }) => {
    await page.goto("/ops");
    await page.waitForTimeout(2000);

    // Show role selection cards
    await expect(page.getByText(/management portal/i)).toBeVisible();
    await expect(page.getByText(/select your role/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /admin/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /staff/i })).toBeVisible();
    await page.waitForTimeout(2000);
  });

  test("admin login page", async ({ page }) => {
    await page.goto("/admin/login");
    await page.waitForTimeout(2000);

    // Show admin login form
    await expect(page.getByText(/admin login/i)).toBeVisible();
    await expect(page.locator("input[type='email']").first()).toBeVisible();
    await page.waitForTimeout(2000);
  });

  test("staff login page", async ({ page }) => {
    await page.goto("/staff/login");
    await page.waitForTimeout(2000);

    // Show staff login form
    await expect(page.getByText(/staff login/i)).toBeVisible();
    await expect(page.locator("input[type='email']").first()).toBeVisible();
    await page.waitForTimeout(2000);
  });

  test("forgot password page", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.waitForTimeout(2000);

    // Show forgot password form
    await page.waitForTimeout(2000);
  });
});
