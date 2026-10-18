import { test, expect } from "@playwright/test";
import { loginAsResident, ACCOUNTS, pickDateRange } from "./helpers";

test.describe("Resident Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsResident(page);
  });

  test("dashboard shows welcome message with name", async ({ page }) => {
    await expect(page.getByText(/welcome back, maria/i)).toBeVisible();
  });

  test("dashboard shows stats cards (upcoming, active)", async ({ page }) => {
    await expect(page.getByText(/upcoming/i).first()).toBeVisible();
    await expect(page.getByText(/active/i).first()).toBeVisible();
  });

  test("dashboard shows pass balance info", async ({ page }) => {
    await expect(page.getByText(/guest passes/i)).toBeVisible();
  });

  test("dashboard has Add Guest button", async ({ page }) => {
    await expect(page.getByRole("button", { name: /add a guest/i })).toBeVisible();
  });

  test("dashboard has search bar", async ({ page }) => {
    await expect(page.getByPlaceholder(/search/i)).toBeVisible();
  });

  test("guest list loads with guest cards", async ({ page }) => {
    // Wait for loading to finish
    await page.waitForTimeout(2000);
    // Should see guest cards or empty state
    const cards = page.locator("[class*='rounded']").filter({ hasText: /approved|active|pending|needs.payment|paid|expired|cancelled/i });
    const empty = page.getByText(/no guests/i);
    const hasCards = await cards.count() > 0;
    const isEmpty = await empty.isVisible().catch(() => false);
    expect(hasCards || isEmpty).toBeTruthy();
  });

  test("search filters guest list", async ({ page }) => {
    await page.waitForTimeout(2000);
    const searchBar = page.getByPlaceholder(/search/i);
    await searchBar.fill("ZZZZNONEXISTENT");
    await page.waitForTimeout(500);
    // Should show empty or no matches
    await expect(page.getByText(/no guests/i)).toBeVisible({ timeout: 5000 });
  });

  test("add guest bottom sheet opens and has form fields", async ({ page }) => {
    await page.getByRole("button", { name: /add a guest/i }).click();
    await expect(page.getByText(/add guest/i).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByPlaceholder(/guest.*name|john doe/i)).toBeVisible();
    await expect(page.getByPlaceholder(/abc.*1234/i)).toBeVisible();
  });

  test("add guest form requires name and plate", async ({ page }) => {
    await page.getByRole("button", { name: /add a guest/i }).click();
    await expect(page.getByPlaceholder(/guest.*name|john doe/i)).toBeVisible({ timeout: 5000 });

    // Pick dates using custom DateRangePicker
    await pickDateRange(page, 0, 1);

    // Try to submit without required fields - form should block
    await page.getByRole("button", { name: /^add guest$/i }).click();
    // Should still be on the form (not closed)
    await expect(page.getByPlaceholder(/guest.*name|john doe/i)).toBeVisible();
  });

  test("tap guest card opens detail bottom sheet", async ({ page }) => {
    await page.waitForTimeout(2000);
    // Use the specific guest card class (bg-surface-container)
    const firstCard = page.locator(".bg-surface-container").first();
    if (await firstCard.isVisible().catch(() => false)) {
      await firstCard.click();
      // Look for the bottom sheet title
      await expect(page.getByRole("heading", { name: /guest details/i })).toBeVisible({ timeout: 5000 });
      // Should show guest info like Name label
      await expect(page.getByText("Name")).toBeVisible();
    }
  });
});

test.describe("Resident Dashboard - Add Guest Flow", () => {
  test("add a guest with valid data creates stay", async ({ page }) => {
    await loginAsResident(page, ACCOUNTS.resident2);
    await page.getByRole("button", { name: /add a guest/i }).click();
    await expect(page.getByPlaceholder(/guest.*name|john doe/i)).toBeVisible({ timeout: 5000 });

    await page.getByPlaceholder(/guest.*name|john doe/i).fill("E2E New Guest");
    await page.getByPlaceholder(/abc.*1234/i).fill(`E2E-${Date.now().toString().slice(-4)}`);
    await page.getByPlaceholder(/toyota|corolla/i).last().fill("Blue Ford");

    // Pick dates using custom DateRangePicker (today to +1 day)
    await pickDateRange(page, 0, 1);

    await page.getByRole("button", { name: /^add guest$/i }).click();

    // Should see either approved confirmation or payment sheet
    const approved = page.getByRole("heading", { name: /approved/i });
    const payment = page.getByText(/complete payment/i);
    await expect(approved.or(payment)).toBeVisible({ timeout: 15000 });
  });
});
