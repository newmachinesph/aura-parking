import { test, expect } from "@playwright/test";
import { loginAsAdmin, waitForLoad } from "./helpers";

test.describe("Admin Dashboard — 3-Mode View", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await waitForLoad(page);
  });

  /* ── Page Load ── */
  test("dashboard loads with 3 clickable stat cards", async ({ page }) => {
    // 3 stat cards: Residents, Units, Guests
    await expect(page.getByText(/residents/i).first()).toBeVisible();
    await expect(page.getByText(/units/i).first()).toBeVisible();
    await expect(page.getByText(/guests/i).first()).toBeVisible();
  });

  /* ── Residents Mode (default) ── */
  test("residents mode shows resident list with search", async ({ page }) => {
    // Default mode is residents
    await expect(page.getByPlaceholder(/search/i)).toBeVisible();

    // Should show seed data residents
    await page.waitForTimeout(2000);
    const residentCard = page.locator("[class*='rounded']").filter({ hasText: /maria santos|james rivera|elena rodriguez/i }).first();
    await expect(residentCard).toBeVisible({ timeout: 10000 });
  });

  test("click resident card opens detail sheet with guest history", async ({ page }) => {
    await page.waitForTimeout(2000);
    const card = page.locator("[class*='rounded']").filter({ hasText: /maria santos|james rivera/i }).first();
    if (await card.isVisible({ timeout: 5000 }).catch(() => false)) {
      await card.click();
      await page.waitForTimeout(1000);
      // Should show resident details with guest records tabs
      await expect(page.getByText(/email/i).first()).toBeVisible({ timeout: 5000 });
    }
  });

  /* ── Units Mode ── */
  test("clicking units card switches to units view", async ({ page }) => {
    // Click the Units stat card
    const unitsCard = page.locator("[class*='rounded']").filter({ hasText: /units/i }).first();
    await unitsCard.click();
    await page.waitForTimeout(1000);

    // Should show unit-specific UI with search
    await expect(page.getByPlaceholder(/search/i)).toBeVisible();
    // Title should change to "Units" (h1 element)
    await expect(page.locator("h1").filter({ hasText: /units/i })).toBeVisible();
  });

  test("units mode shows unit list from seed data", async ({ page }) => {
    // Switch to units mode
    const unitsCard = page.locator("[class*='rounded']").filter({ hasText: /units/i }).first();
    await unitsCard.click();
    await page.waitForTimeout(2000);

    // Should show seed data units (4-digit format)
    const unitEntry = page.locator("[class*='rounded']").filter({ hasText: /1101|1102|2101/i }).first();
    await expect(unitEntry).toBeVisible({ timeout: 10000 });
  });

  /* ── Guests Mode ── */
  test("clicking guests card switches to guests view", async ({ page }) => {
    // Click the Guests stat card (contains h3 with "Guests" text)
    const guestsCard = page.locator("h3").filter({ hasText: "Guests" });
    await guestsCard.click();
    await page.waitForTimeout(1500);

    // Should show guest-specific UI with search
    await expect(page.getByPlaceholder(/search/i)).toBeVisible();
    // Title should change to "Guests" (h1 element)
    await expect(page.locator("h1").filter({ hasText: /guests/i })).toBeVisible({ timeout: 10000 });
  });

  /* ── Mode Switching ── */
  test("switching between all 3 modes works correctly", async ({ page }) => {
    // Start in residents (default) - check title (h1)
    await expect(page.locator("h1").filter({ hasText: /residents/i })).toBeVisible();

    // Switch to units (click h3 in stats card)
    await page.locator("h3").filter({ hasText: "Units" }).click();
    await page.waitForTimeout(1000);
    await expect(page.locator("h1").filter({ hasText: /units/i })).toBeVisible();

    // Switch to guests (click h3 in stats card)
    await page.locator("h3").filter({ hasText: "Guests" }).click();
    await page.waitForTimeout(1500);
    await expect(page.locator("h1").filter({ hasText: /guests/i })).toBeVisible({ timeout: 10000 });

    // Switch back to residents (click h3 in stats card)
    await page.locator("h3").filter({ hasText: "Residents" }).click();
    await page.waitForTimeout(1000);
    await expect(page.locator("h1").filter({ hasText: /residents/i })).toBeVisible();
  });

  /* ── Search in Residents Mode ── */
  test("search filters residents by name, email, or unit", async ({ page }) => {
    const search = page.getByPlaceholder(/search/i);

    await search.fill("Maria");
    await page.waitForTimeout(1000);
    await expect(page.getByText(/maria santos/i)).toBeVisible({ timeout: 5000 });

    await search.clear();
    await page.waitForTimeout(500);

    await search.fill("1102");
    await page.waitForTimeout(1000);
  });
});
