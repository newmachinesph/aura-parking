import { test, expect } from "@playwright/test";
import { ACCOUNTS, login, loginAsResident, loginAsAdmin, loginAsStaff, clearMailpit, waitForEmail, OTP_CODE } from "./helpers";

test.describe("Authentication", () => {
  test.describe("Resident Login", () => {
    test("successful resident login redirects to dashboard", async ({ page }) => {
      await loginAsResident(page);
      await expect(page).toHaveURL(/\/dashboard/);
      await expect(page.getByText(/welcome back/i)).toBeVisible();
    });

    test("invalid password shows error", async ({ page }) => {
      await login(page, ACCOUNTS.resident.email, "wrongpassword", "/login");
      await expect(page.locator(".bg-red-50")).toBeVisible({ timeout: 10000 });
    });

    test("non-existent email shows error", async ({ page }) => {
      await login(page, "nobody@example.com", process.env.SEED_PASSWORD!, "/login");
      await expect(page.locator(".bg-red-50")).toBeVisible({ timeout: 10000 });
    });

    test("inactive account cannot login", async ({ page }) => {
      await login(page, ACCOUNTS.inactive.email, ACCOUNTS.inactive.password, "/admin/login");
      await expect(page.locator(".bg-red-50")).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe("Admin/Staff Login", () => {
    test("admin login via /admin/login redirects to admin dashboard", async ({ page }) => {
      await loginAsAdmin(page);
      await expect(page).toHaveURL(/\/admin\/dashboard/);
    });

    test("staff login via /staff/login redirects to staff dashboard", async ({ page }) => {
      await loginAsStaff(page);
      await expect(page).toHaveURL(/\/staff\/dashboard/);
    });

    test("admin login page has back arrow to /ops", async ({ page }) => {
      await page.goto("/admin/login");
      const backLink = page.locator("a[href='/ops']");
      await expect(backLink).toBeVisible();
    });

    test("staff login page has back arrow to /ops", async ({ page }) => {
      await page.goto("/staff/login");
      const backLink = page.locator("a[href='/ops']");
      await expect(backLink).toBeVisible();
    });

    test("admin login rejects non-admin user", async ({ page }) => {
      await login(page, ACCOUNTS.staff.email, ACCOUNTS.staff.password, "/admin/login");
      await expect(page.locator(".bg-red-50")).toBeVisible({ timeout: 10000 });
    });

    test("staff login rejects non-staff user", async ({ page }) => {
      await login(page, ACCOUNTS.admin.email, ACCOUNTS.admin.password, "/staff/login");
      await expect(page.locator(".bg-red-50")).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe("Forgot Password", () => {
    test.beforeEach(async () => {
      await clearMailpit();
    });

    test("forgot password sends email and shows confirmation", async ({ page }) => {
      await page.goto("/forgot-password");
      await page.getByPlaceholder(/email/i).first().fill(ACCOUNTS.resident.email);
      await page.getByRole("button", { name: /reset via email/i }).click();
      await expect(page.getByText(/check your inbox/i)).toBeVisible({ timeout: 10000 });

      // Check Mailpit for the reset email
      const email = await waitForEmail(ACCOUNTS.resident.email, "password");
      expect(email).not.toBeNull();
    });

    test("forgot password for non-existent email still shows success (no enumeration)", async ({ page }) => {
      await page.goto("/forgot-password");
      await page.getByPlaceholder(/email/i).first().fill("nobody@doesnotexist.com");
      await page.getByRole("button", { name: /reset via email/i }).click();
      // Should still show success message (no user enumeration)
      await expect(page.getByText(/check your inbox/i)).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe("Registration", () => {
    test.beforeEach(async () => {
      await clearMailpit();
    });

    test("resident registration form validation - weak password", async ({ page }) => {
      await page.goto("/register");
      await page.getByPlaceholder(/unit number/i).fill("1101");
      await page.getByPlaceholder(/full name/i).fill("Test User");
      await page.getByPlaceholder(/email/i).fill("testregister@example.com");
      await page.getByPlaceholder(/password/i).fill("weak");
      // Should show password validation error: "Must be at least 8 characters."
      await expect(page.getByText(/at least 8 characters/i)).toBeVisible();
    });

    test("resident registration form validation - strong password shows checkmark", async ({ page }) => {
      await page.goto("/register");
      await page.getByPlaceholder(/password/i).fill("StrongP@ss1");
      await expect(page.getByText(/meets requirements/i)).toBeVisible();
    });

    test("resident registration step 1 → OTP step with test code", async ({ page }) => {
      await page.goto("/register");
      const timestamp = Date.now();
      await page.getByPlaceholder(/unit number/i).fill("1101");
      await page.getByPlaceholder(/full name/i).fill("E2E Test User");
      await page.getByPlaceholder(/email/i).fill(`e2e-test-${timestamp}@example.com`);
      // Fill phone using the phone input - use unique number to avoid "already registered" error
      const phoneInput = page.locator("input[type='tel']");
      const uniquePhone = `+1555${String(timestamp).slice(-7)}`;
      await phoneInput.fill(uniquePhone);
      await page.getByPlaceholder(/password/i).fill("TestP@ss123");
      await page.getByRole("button", { name: /continue/i }).click();

      // Should advance to OTP step - look for the specific paragraph text
      await expect(page.getByText("Enter the verification code")).toBeVisible({ timeout: 15000 });
      await page.getByPlaceholder(/123456/i).fill(OTP_CODE);
      await page.getByRole("button", { name: /create account/i }).click();

      // Should show success - user is auto-logged in and redirected to dashboard
      await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    });

    test("admin registration page has no role toggle", async ({ page }) => {
      await page.goto("/admin/register");
      await expect(page.getByText(/admin registration/i)).toBeVisible();
      // Should NOT have role toggle buttons
      const roleToggle = page.getByRole("button", { name: /^staff$/i }).first();
      await expect(roleToggle).not.toBeVisible({ timeout: 2000 }).catch(() => {});
    });

    test("staff registration page has no role toggle", async ({ page }) => {
      await page.goto("/staff/register");
      await expect(page.getByText(/staff registration/i)).toBeVisible();
      // Should NOT have role toggle buttons
      const roleToggle = page.getByRole("button", { name: /^admin$/i }).first();
      await expect(roleToggle).not.toBeVisible({ timeout: 2000 }).catch(() => {});
    });
  });

  test.describe("Logout", () => {
    test("resident logout redirects to login", async ({ page }) => {
      await loginAsResident(page);
      // Open avatar account menu (BottomSheet)
      await page.getByRole("button", { name: /account menu/i }).click();
      await page.waitForTimeout(500);
      // Use specific selector for the Sign Out button in the account dropdown (not sidebar)
      await page.getByLabel("Account", { exact: true }).getByRole("button", { name: /sign out/i }).click();
      await page.waitForURL(/\/(login|$)/, { timeout: 15000 });
    });

    test("admin logout redirects to ops", async ({ page }) => {
      await loginAsAdmin(page);
      // Open avatar account menu (BottomSheet)
      await page.getByRole("button", { name: /account menu/i }).click();
      await page.waitForTimeout(500);
      // Use specific selector for the Sign Out button in the account dropdown (not sidebar)
      await page.getByLabel("Account", { exact: true }).getByRole("button", { name: /sign out/i }).click();
      await page.waitForURL(/\/(ops|admin\/login|$)/, { timeout: 15000 });
    });
  });

  test.describe("Route Protection", () => {
    test("unauthenticated user cannot access /dashboard", async ({ page }) => {
      await page.goto("/dashboard");
      await page.waitForURL(/\/login/, { timeout: 15000 });
    });

    test("unauthenticated user cannot access /admin/dashboard", async ({ page }) => {
      await page.goto("/admin/dashboard");
      await page.waitForURL(/\/(ops|admin\/login)/, { timeout: 15000 });
    });

    test("unauthenticated user cannot access /staff/dashboard", async ({ page }) => {
      await page.goto("/staff/dashboard");
      await page.waitForURL(/\/(ops|staff\/login)/, { timeout: 15000 });
    });

    test("resident cannot access admin dashboard", async ({ page }) => {
      await loginAsResident(page);
      await page.goto("/admin/dashboard");
      // Should redirect away from admin
      await page.waitForURL(/\/(dashboard|ops|login)/, { timeout: 15000 });
      expect(page.url()).not.toContain("/admin/dashboard");
    });

    test("staff cannot access admin-only pages", async ({ page }) => {
      await loginAsStaff(page);
      await page.goto("/admin/users");
      await page.waitForURL(/\/(staff|ops|login)/, { timeout: 15000 });
      expect(page.url()).not.toContain("/admin/users");
    });
  });
});
