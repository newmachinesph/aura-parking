import { test, expect } from "@playwright/test";
import { loginAsResident, ACCOUNTS, clearMailpit, pickDateRange } from "./helpers";

test.describe("DEMO: Mailpit Email Verification", () => {
  test.beforeEach(async () => {
    await clearMailpit();
  });

  test("guest request sends emails — then view in Mailpit", async ({ page }) => {
    // Step 1: Submit a guest parking request
    await page.goto("/guest");
    await page.waitForTimeout(1500);

    // Verify resident
    await page.getByPlaceholder(/resident.*email|resident@example/i).first().fill("r03@example.com");
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /find resident/i }).click();
    await expect(page.getByText(/verified resident/i)).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // Fill guest details
    await page.getByPlaceholder(/guest.*name|guest full name/i).first().fill("Email Demo Guest");
    await page.waitForTimeout(300);
    await page.getByPlaceholder(/guest.*email|guest email/i).first().fill("emaildemo@guest.com");
    await page.waitForTimeout(300);
    await page.getByPlaceholder(/plate|llk/i).first().fill(`MAIL-${Date.now().toString().slice(-4)}`);
    await page.waitForTimeout(300);
    await page.getByPlaceholder(/toyota|white/i).first().fill("White Honda Civic");
    await page.waitForTimeout(300);

    // Pick dates
    await pickDateRange(page, 0, 2);
    await page.waitForTimeout(500);

    // Submit
    await page.getByRole("button", { name: /confirm/i }).click();
    await expect(page.getByText(/request submitted/i)).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // Step 2: Navigate to Mailpit to show the emails
    await page.goto("http://localhost:8025");
    await page.waitForTimeout(3000);

    // Mailpit inbox should show emails
    await page.waitForTimeout(2000);

    // Click first email to view it
    const firstEmail = page.locator("tr.message, [class*='message'], a[href*='message']").first();
    if (await firstEmail.isVisible().catch(() => false)) {
      await firstEmail.click();
      await page.waitForTimeout(3000);

      // Show email content
      await page.waitForTimeout(2000);
    }
    await page.waitForTimeout(2000);
  });

  test("forgot password sends email — view in Mailpit", async ({ page }) => {
    // Step 1: Trigger forgot password
    await page.goto("/forgot-password");
    await page.waitForTimeout(1000);

    await page.getByPlaceholder(/email/i).first().fill("r03@example.com");
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /reset via email/i }).click();
    await expect(page.getByText(/check your inbox/i)).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);

    // Step 2: Navigate to Mailpit
    await page.goto("http://localhost:8025");
    await page.waitForTimeout(3000);

    // Should see the password reset email
    await page.waitForTimeout(2000);

    // Click first email
    const firstEmail = page.locator("tr.message, [class*='message'], a[href*='message']").first();
    if (await firstEmail.isVisible().catch(() => false)) {
      await firstEmail.click();
      await page.waitForTimeout(3000);
    }
    await page.waitForTimeout(2000);
  });
});
