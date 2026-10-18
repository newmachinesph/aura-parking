import { test, expect } from "@playwright/test";
import { pickDateRange } from "./helpers";

test.describe("DEMO: Guest Public Form Flow", () => {
  test("guest submits a parking request via public form", async ({ page }) => {
    // Navigate to the guest form
    await page.goto("/guest");
    await page.waitForTimeout(1500);

    // Step 1: Verify Resident — by Email
    await expect(page.getByText(/guest parking/i)).toBeVisible();
    await page.waitForTimeout(1000);

    // Fill in resident email
    const emailInput = page.getByPlaceholder(/resident.*email|resident@example/i).first();
    await emailInput.click();
    await page.waitForTimeout(300);
    await emailInput.fill("r01@example.com");
    await page.waitForTimeout(800);

    // Click Find Resident
    await page.getByRole("button", { name: /find resident/i }).click();
    await page.waitForTimeout(2000);

    // Should see "Verified Resident" banner
    await expect(page.getByText(/verified resident/i)).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1500);

    // Step 2: Fill in guest details
    await page.getByPlaceholder(/guest.*name|guest full name/i).first().fill("John Smith");
    await page.waitForTimeout(500);

    await page.getByPlaceholder(/guest.*email|guest email/i).first().fill("john.smith@example.com");
    await page.waitForTimeout(500);

    await page.getByPlaceholder(/plate|llk/i).first().fill("JSM-2024");
    await page.waitForTimeout(500);

    await page.getByPlaceholder(/toyota|white/i).first().fill("White Honda Civic 2023");
    await page.waitForTimeout(500);

    // Pick dates using the custom DateRangePicker (today to +3 days)
    await pickDateRange(page, 0, 3);
    await page.waitForTimeout(1500);

    // Click Confirm
    await page.getByRole("button", { name: /confirm/i }).click();
    await page.waitForTimeout(3000);

    // Step 3: Success — should show "Request Submitted" and reference code
    await expect(page.getByText(/request submitted/i)).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // Show the reference code and details
    await expect(page.getByText(/reference code/i)).toBeVisible();
    await page.waitForTimeout(3000);
  });

  test("guest form: search by unit number", async ({ page }) => {
    await page.goto("/guest");
    await page.waitForTimeout(1500);

    // Switch to "By Unit" tab
    const unitTab = page.getByText(/by unit/i);
    if (await unitTab.isVisible().catch(() => false)) {
      await unitTab.click();
      await page.waitForTimeout(800);
    }

    // Fill unit number
    const unitInput = page.getByPlaceholder(/unit|402/i).first();
    if (await unitInput.isVisible().catch(() => false)) {
      await unitInput.fill("1102");
      await page.waitForTimeout(800);

      await page.getByRole("button", { name: /find resident/i }).click();
      await page.waitForTimeout(2000);

      // Should find the resident
      await expect(page.getByText(/verified resident/i)).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(2000);
    }
  });
});
