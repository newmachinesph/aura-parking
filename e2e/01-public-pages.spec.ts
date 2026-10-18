import { test, expect } from "@playwright/test";

test.describe("Public Pages", () => {
  test("landing page loads with resident and guest buttons", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /resident/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /guest/i })).toBeVisible();
  });

  test("landing page has management link", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /management/i })).toBeVisible();
  });

  test("resident gateway page shows login and register", async ({ page }) => {
    await page.goto("/resident");
    await expect(page.getByRole("link", { name: /log in/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /register/i })).toBeVisible();
  });

  test("guest parking page loads verify step", async ({ page }) => {
    await page.goto("/guest");
    await expect(page.getByText(/guest parking/i)).toBeVisible();
    await expect(page.getByText(/find your host/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /find resident/i })).toBeVisible();
  });

  test("ops page shows admin and staff role choices", async ({ page }) => {
    await page.goto("/ops");
    await expect(page.getByText(/management portal/i)).toBeVisible();
    await expect(page.getByText(/select your role/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /admin/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /staff/i })).toBeVisible();
  });

  test("admin login page loads with form", async ({ page }) => {
    await page.goto("/admin/login");
    await expect(page.getByText(/admin login/i)).toBeVisible();
    await expect(page.locator("input[type='email']").first()).toBeVisible();
    await expect(page.getByPlaceholder(/password/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("staff login page loads with form", async ({ page }) => {
    await page.goto("/staff/login");
    await expect(page.getByText(/staff login/i)).toBeVisible();
    await expect(page.locator("input[type='email']").first()).toBeVisible();
    await expect(page.getByPlaceholder(/password/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("forgot password page loads", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByText(/reset password/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /reset via email/i })).toBeVisible();
  });

  test("register page loads with form fields", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByText(/create account/i)).toBeVisible();
    await expect(page.getByPlaceholder(/unit number/i)).toBeVisible();
    await expect(page.getByPlaceholder(/full name/i)).toBeVisible();
    await expect(page.getByPlaceholder(/email/i).first()).toBeVisible();
  });

  test("admin register page loads with dedicated admin form", async ({ page }) => {
    await page.goto("/admin/register");
    await expect(page.getByText(/admin registration/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /submit registration/i })).toBeVisible();
  });

  test("staff register page loads with dedicated staff form", async ({ page }) => {
    await page.goto("/staff/register");
    await expect(page.getByText(/staff registration/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /submit registration/i })).toBeVisible();
  });
});
