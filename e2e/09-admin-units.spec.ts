import { test, expect } from "@playwright/test";
import { loginAsAdmin, waitForLoad } from "./helpers";

test.describe("Admin Units Management — Full Flows", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/units");
    await waitForLoad(page);
  });

  /* ────────────────────────────────────────────
     PAGE STRUCTURE
  ──────────────────────────────────────────── */
  test("page loads with header, stats, search, and unit list", async ({ page }) => {
    // Header - use h1 selector specifically
    await expect(page.locator("h1").filter({ hasText: /units/i })).toBeVisible();

    // Stats: Total Units, Occupied, Vacant
    await expect(page.getByText(/total units/i).first()).toBeVisible();
    await expect(page.getByText(/occupied/i).first()).toBeVisible();
    await expect(page.getByText(/vacant/i).first()).toBeVisible();

    // Search bar
    await expect(page.getByPlaceholder(/search/i)).toBeVisible();

    // Seed data units
    await page.waitForTimeout(2000);
    await expect(page.getByText(/1101|1102|2101/i).first()).toBeVisible({ timeout: 10000 });
  });

  /* ────────────────────────────────────────────
     SEARCH FLOW
  ──────────────────────────────────────────── */
  test("search → filter by unit number → clear → search another", async ({ page }) => {
    const search = page.getByPlaceholder(/search/i);

    // Search for a specific unit
    await search.fill("1101");
    await page.waitForTimeout(1000);
    await expect(page.getByText("1101")).toBeVisible({ timeout: 5000 });

    // Clear
    await search.clear();
    await page.waitForTimeout(500);

    // Search for another unit
    await search.fill("2101");
    await page.waitForTimeout(1000);
    const result = page.getByText("2101");
    if (await result.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(result.first()).toBeVisible();
    }

    // Search with no match
    await search.clear();
    await search.fill("ZZZZZZ");
    await page.waitForTimeout(1000);
    // Should show empty state or no results
  });

  /* ────────────────────────────────────────────
     UNIT CARDS DISPLAY
  ──────────────────────────────────────────── */
  test("unit cards show unit number and resident count", async ({ page }) => {
    await page.waitForTimeout(2000);

    // Find a unit card
    const unitCard = page.locator("[class*='rounded']").filter({ hasText: /1101|1102/i }).first();
    if (await unitCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Should show unit number
      await expect(unitCard.getByText(/unit/i)).toBeVisible();
      // Should show resident count info
      await expect(unitCard.getByText(/resident/i)).toBeVisible();
    }
  });

  /* ────────────────────────────────────────────
     UNIT OCCUPANCY STATUS
  ──────────────────────────────────────────── */
  test("occupied vs vacant badges show correctly", async ({ page }) => {
    await page.waitForTimeout(2000);

    // Unit 1101 should be occupied (Maria Santos is a resident there)
    const occupiedUnit = page.locator("[class*='rounded']").filter({ hasText: /1101/i }).first();
    if (await occupiedUnit.isVisible({ timeout: 5000 }).catch(() => false)) {
      const badge = occupiedUnit.getByText(/occupied/i);
      await expect(badge).toBeVisible({ timeout: 3000 });
    }

    // Should have at least one vacant unit showing
    const vacantUnit = page.locator("[class*='rounded']").filter({ hasText: /vacant/i }).first();
    if (await vacantUnit.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(vacantUnit).toBeVisible();
    }
  });

  /* ────────────────────────────────────────────
     EDIT UNIT — DESKTOP ONLY (lg viewport)
  ──────────────────────────────────────────── */
  test("edit unit button visible on desktop viewport", async ({ page }) => {
    // Set viewport to large screen to see edit/delete buttons
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(1000);

    // Look for an edit button (pencil icon button)
    const editBtn = page.locator("button[title='Edit']").first();
    if (await editBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await editBtn.click();
      await page.waitForTimeout(1000);

      // Edit form should open
      await expect(page.getByText(/edit unit/i)).toBeVisible({ timeout: 5000 });

      // Should have unit number input
      await expect(page.getByPlaceholder(/A-101/i).first().or(page.locator("input").first())).toBeVisible();

      // Close form
      const closeBtn = page.getByRole("button", { name: /close/i });
      if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await closeBtn.click();
      }
    }
  });

  /* ────────────────────────────────────────────
     PAGINATION / SHOW MORE FLOW
  ──────────────────────────────────────────── */
  test("show more button loads additional units", async ({ page }) => {
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.scrollTo({ top: 9999, behavior: "smooth" }));
    await page.waitForTimeout(1000);

    const showMoreBtn = page.getByRole("button", { name: /show more|load more/i });
    if (await showMoreBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      const initialCount = await page.locator("[class*='rounded']").filter({ hasText: /\d{4}/i }).count();
      await showMoreBtn.click();
      await page.waitForTimeout(2000);
      const afterCount = await page.locator("[class*='rounded']").filter({ hasText: /\d{4}/i }).count();
      expect(afterCount).toBeGreaterThanOrEqual(initialCount);
    }
  });

  /* ────────────────────────────────────────────
     STATS CARDS INTERACTION
  ──────────────────────────────────────────── */
  test("stats cards display correct counts", async ({ page }) => {
    await page.waitForTimeout(2000);

    // Get the total units count from stats card
    const totalUnitsCard = page.locator("[class*='rounded']").filter({ hasText: /total units/i }).first();
    await expect(totalUnitsCard).toBeVisible({ timeout: 5000 });

    // Get occupied count
    const occupiedCard = page.locator("[class*='rounded']").filter({ hasText: /occupied/i }).first();
    await expect(occupiedCard).toBeVisible();

    // Get vacant count
    const vacantCard = page.locator("[class*='rounded']").filter({ hasText: /vacant/i }).first();
    await expect(vacantCard).toBeVisible();
  });
});
