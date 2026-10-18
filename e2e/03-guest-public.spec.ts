import { test, expect } from "@playwright/test";
import { clearMailpit, waitForEmail, pickDateRange } from "./helpers";

test.describe("Guest Public Parking Request", () => {
  test.beforeEach(async () => {
    await clearMailpit();
  });

  test("verify resident by email then submit guest request", async ({ page }) => {
    await page.goto("/guest");

    // Step 1: Verify resident by email
    await expect(page.getByText(/find your host/i)).toBeVisible();
    // "By Email" tab should be active by default
    await page.getByPlaceholder(/resident|email/i).first().fill("r01@example.com");
    await page.getByRole("button", { name: /find resident/i }).click();

    // Should show verified resident banner
    await expect(page.getByText(/verified resident/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/maria santos/i)).toBeVisible();

    // Step 2: Fill guest details
    await page.getByPlaceholder(/guest.*name|john doe/i).fill("E2E Test Guest");
    await page.getByPlaceholder(/guest.*email/i).fill("e2e-guest@test.com");
    await page.getByPlaceholder(/plate|llk/i).fill("E2E-001");
    await page.getByPlaceholder(/toyota/i).fill("Red Honda");

    // Pick date range using custom DateRangePicker (today to +1 day)
    await pickDateRange(page, 0, 1);

    await page.getByRole("button", { name: /confirm/i }).click();

    // Should show success with reference code
    await expect(page.getByText(/request submitted/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/AP-/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /save reference/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /done/i })).toBeVisible();

    // Check emails sent
    const guestEmail = await waitForEmail("e2e-guest@test.com");
    expect(guestEmail).not.toBeNull();
  });

  test("verify resident by unit number", async ({ page }) => {
    await page.goto("/guest");
    // Switch to "By Unit" tab
    await page.getByRole("button", { name: /by unit/i }).click();
    await page.getByPlaceholder(/unit number|402/i).fill("1102");
    await page.getByRole("button", { name: /find resident/i }).click();
    await expect(page.getByText(/verified resident/i)).toBeVisible({ timeout: 10000 });
  });

  test("verify resident with invalid email shows error", async ({ page }) => {
    await page.goto("/guest");
    await page.getByPlaceholder(/resident|email/i).first().fill("nobody@doesnotexist.com");
    await page.getByRole("button", { name: /find resident/i }).click();
    await expect(page.locator(".bg-red-50")).toBeVisible({ timeout: 10000 });
  });

  test("verify resident with invalid unit shows error", async ({ page }) => {
    await page.goto("/guest");
    await page.getByRole("button", { name: /by unit/i }).click();
    await page.getByPlaceholder(/unit number|402/i).fill("Z-999");
    await page.getByRole("button", { name: /find resident/i }).click();
    await expect(page.locator(".bg-red-50")).toBeVisible({ timeout: 10000 });
  });

  test("can go back from details to verify step", async ({ page }) => {
    await page.goto("/guest");
    await page.getByPlaceholder(/resident|email/i).first().fill("r01@example.com");
    await page.getByRole("button", { name: /find resident/i }).click();
    await expect(page.getByText(/verified resident/i)).toBeVisible({ timeout: 10000 });

    // Click "Previous" to go back
    await page.getByRole("button", { name: /previous/i }).click();
    await expect(page.getByText(/find your host/i)).toBeVisible();
  });

  test("GP-E10: guest email is optional (can submit without email)", async ({ page }) => {
    await page.goto("/guest");

    // Verify resident
    await page.getByPlaceholder(/resident|email/i).first().fill("r03@example.com");
    await page.getByRole("button", { name: /find resident/i }).click();
    await expect(page.getByText(/verified resident/i)).toBeVisible({ timeout: 10000 });

    // Fill guest details WITHOUT email
    await page.getByPlaceholder(/guest.*name|john doe/i).fill("No Email Guest");
    // Leave email field empty
    await page.getByPlaceholder(/plate|llk/i).fill(`NOEM-${Date.now().toString().slice(-4)}`);
    await page.getByPlaceholder(/toyota/i).fill("Blue Ford");

    // Pick dates
    await pickDateRange(page, 1, 2);

    await page.getByRole("button", { name: /confirm/i }).click();

    // Should succeed without email
    await expect(page.getByText(/request submitted/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/AP-/).first()).toBeVisible();
  });
});
