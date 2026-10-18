import { test, expect } from "@playwright/test";
import { loginAsResident, ACCOUNTS, OTP_CODE, pickDateRange } from "./helpers";

test.describe("DEMO: Resident Registration", () => {
  test("new resident registers an account", async ({ page }) => {
    await page.goto("/register");
    await page.waitForTimeout(1500);

    // Fill in registration form
    await page.getByPlaceholder(/unit number/i).fill("B-205");
    await page.waitForTimeout(500);

    await page.getByPlaceholder(/full name/i).fill("Demo Resident");
    await page.waitForTimeout(500);

    await page.getByPlaceholder(/email/i).first().fill(`demo-${Date.now()}@test.com`);
    await page.waitForTimeout(500);

    // Phone input — react-international-phone renders its own input
    // Use unique phone number to avoid "already registered" error
    const randomPhone = `555${Date.now().toString().slice(-7)}`;
    const phoneInput = page.locator("input[type='tel']").first();
    await phoneInput.click();
    await page.waitForTimeout(300);
    await phoneInput.pressSequentially(randomPhone, { delay: 50 });
    await page.waitForTimeout(500);

    await page.getByPlaceholder(/password/i).fill("DemoP@ss123");
    await page.waitForTimeout(800);

    // Show password meets requirements
    await expect(page.getByText(/meets requirements/i)).toBeVisible();
    await page.waitForTimeout(1500);

    // Submit form
    await page.getByRole("button", { name: /continue/i }).click();
    await page.waitForTimeout(2000);

    // OTP step - enter test code
    await expect(page.getByPlaceholder(/123456/i)).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1000);

    await page.getByPlaceholder(/123456/i).fill(OTP_CODE);
    await page.waitForTimeout(1000);

    await page.getByRole("button", { name: /create account/i }).click();
    await page.waitForTimeout(3000);

    // Should show success page OR auto-login to dashboard
    const success = page.getByText(/registration submitted/i);
    const dashboard = page.getByText(/welcome back/i);
    await expect(success.or(dashboard)).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(3000);
  });
});

test.describe("DEMO: Resident Dashboard & Guest Management", () => {
  test("resident logs in and views dashboard", async ({ page }) => {
    // Login as resident
    await page.goto("/login");
    await page.waitForTimeout(1000);

    await page.locator("input[type='email']").first().fill(ACCOUNTS.resident.email);
    await page.waitForTimeout(500);
    await page.getByPlaceholder(/password/i).first().fill(ACCOUNTS.resident.password);
    await page.waitForTimeout(500);

    await page.getByRole("button", { name: /login/i }).click();
    await page.waitForURL("**/dashboard", { timeout: 15000 });
    await page.waitForTimeout(2000);

    // Dashboard is visible with welcome message
    await expect(page.getByText(/welcome back/i)).toBeVisible();
    await page.waitForTimeout(1500);

    // Show stats cards
    await expect(page.getByText(/upcoming/i).first()).toBeVisible();
    await page.waitForTimeout(1000);

    // Show guest pass balance
    await expect(page.getByText(/guest passes/i).first()).toBeVisible();
    await page.waitForTimeout(2000);

    // Scroll down to see guest list
    await page.evaluate(() => window.scrollTo({ top: 500, behavior: "smooth" }));
    await page.waitForTimeout(2000);
  });

  test("resident adds a new guest", async ({ page }) => {
    await loginAsResident(page);
    await page.waitForTimeout(1500);

    // Click "Add a Guest" button
    await page.getByRole("button", { name: /add.*guest/i }).first().click();
    await page.waitForTimeout(1500);

    // Fill guest form in BottomSheet
    await page.getByPlaceholder(/john doe/i).fill("Alice Johnson");
    await page.waitForTimeout(500);

    await page.getByPlaceholder(/guest@email/i).fill("alice@guest.com");
    await page.waitForTimeout(500);

    await page.getByPlaceholder(/abc-1234/i).fill("ALJ-5678");
    await page.waitForTimeout(500);

    await page.getByPlaceholder(/toyota/i).fill("Blue BMW X5 2024");
    await page.waitForTimeout(500);

    // Pick dates using custom DateRangePicker
    await pickDateRange(page, 0, 2);
    await page.waitForTimeout(1500);

    // Submit
    await page.getByRole("button", { name: /add guest/i }).last().click();
    await page.waitForTimeout(3000);

    // Scroll to see the new guest in the list
    await page.evaluate(() => window.scrollTo({ top: 300, behavior: "smooth" }));
    await page.waitForTimeout(2000);
  });

  test("resident views guest details and approves", async ({ page }) => {
    await loginAsResident(page);
    await page.waitForTimeout(1500);

    // Scroll to guest list
    await page.evaluate(() => window.scrollTo({ top: 300, behavior: "smooth" }));
    await page.waitForTimeout(1000);

    // Click first guest card with pending status
    const guestCard = page.locator("[class*='rounded']").filter({ hasText: /pending/i }).first();
    if (await guestCard.isVisible().catch(() => false)) {
      await guestCard.click();
      await page.waitForTimeout(2000);

      // Should see detail sheet with billing info
      await page.waitForTimeout(2000);

      // Look for approve button
      const approveBtn = page.getByRole("button", { name: /approve/i }).first();
      if (await approveBtn.isVisible().catch(() => false)) {
        await approveBtn.click();
        await page.waitForTimeout(3000);
      }
    }
    await page.waitForTimeout(2000);
  });

  test("resident views passes page and balance", async ({ page }) => {
    await loginAsResident(page);
    await page.goto("/dashboard/passes");
    await page.waitForTimeout(2000);

    // Show pass balance
    await expect(page.getByText(/pass balance/i).first()).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);

    // Show bundle cards
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: "smooth" }));
    await page.waitForTimeout(2000);

    // Show buy options
    await expect(page.getByText(/buy pass bundles/i).first()).toBeVisible();
    await page.waitForTimeout(3000);
  });

  test("resident signs out via avatar menu", async ({ page }) => {
    await loginAsResident(page);
    await page.waitForTimeout(1500);

    // Open avatar dropdown
    await page.getByRole("button", { name: /account menu/i }).click();
    await page.waitForTimeout(2000);

    // Show account sheet with profile info
    await page.waitForTimeout(1500);

    // Click Sign Out (inside the Account BottomSheet, not sidebar)
    await page.getByLabel("Account", { exact: true }).getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL(/\/(login|$)/, { timeout: 15000 });
    await page.waitForTimeout(2000);
  });
});
