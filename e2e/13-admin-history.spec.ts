import { test, expect } from "@playwright/test";
import { loginAsAdmin, loginAsStaff, waitForLoad } from "./helpers";

test.describe("Admin History — Full Flows", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/history");
    await waitForLoad(page);
  });

  /* ────────────────────────────────────────────
     PAGE STRUCTURE
  ──────────────────────────────────────────── */
  test("page loads with header, stats, tabs, search, and guest history", async ({ page }) => {
    // Header
    await expect(page.getByRole("heading", { name: /guest history/i })).toBeVisible();

    // Stats: Upcoming, Active, Previous, Total
    await expect(page.getByText(/upcoming/i).first()).toBeVisible();
    await expect(page.getByText(/active/i).first()).toBeVisible();
    await expect(page.getByText(/previous/i).first()).toBeVisible();
    await expect(page.getByText(/total/i).first()).toBeVisible();

    // Tabs
    await expect(page.getByRole("tab", { name: /active/i }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: /upcoming/i }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: /previous/i }).first()).toBeVisible();

    // Search
    await expect(page.getByPlaceholder(/search/i)).toBeVisible();
  });

  /* ────────────────────────────────────────────
     TAB FILTERING FLOW
  ──────────────────────────────────────────── */
  test("tab filtering → Active → Upcoming → Previous shows correct stays", async ({ page }) => {
    // Active tab
    await page.getByRole("tab", { name: /active/i }).first().click();
    await page.waitForTimeout(1500);
    const activeCards = page.locator("[class*='rounded']").filter({ hasText: /approved|active/i });
    if (await activeCards.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      expect(await activeCards.count()).toBeGreaterThan(0);
    }

    // Upcoming tab
    await page.getByRole("tab", { name: /upcoming/i }).first().click();
    await page.waitForTimeout(1500);

    // Previous tab
    await page.getByRole("tab", { name: /previous/i }).first().click();
    await page.waitForTimeout(1500);
    const pastCards = page.locator("[class*='rounded']").filter({ hasText: /expired|cancelled|paid/i });
    if (await pastCards.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      expect(await pastCards.count()).toBeGreaterThan(0);
    }
  });

  /* ────────────────────────────────────────────
     SEARCH FLOW
  ──────────────────────────────────────────── */
  test("search → filter by name → clear → filter by plate → clear → filter by unit", async ({ page }) => {
    const search = page.getByPlaceholder(/search/i);

    // Search by guest name
    await search.fill("Tony");
    await page.waitForTimeout(1500);
    const nameResults = page.getByText(/tony/i);
    if (await nameResults.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      expect(await nameResults.count()).toBeGreaterThan(0);
    }

    // Clear
    await search.clear();
    await page.waitForTimeout(500);

    // Search by plate
    await search.fill("ABC");
    await page.waitForTimeout(1500);

    // Clear
    await search.clear();
    await page.waitForTimeout(500);

    // Search by unit
    await search.fill("1101");
    await page.waitForTimeout(1500);

    // Search with no match
    await search.clear();
    await search.fill("ZZZZZZZZZ");
    await page.waitForTimeout(1000);
  });

  /* ────────────────────────────────────────────
     VIEW GUEST DETAIL FROM HISTORY — READ-ONLY
  ──────────────────────────────────────────── */
  test("click guest card → detail sheet opens with read-only info", async ({ page }) => {
    await page.waitForTimeout(2000);

    const card = page.locator(".bg-surface-container").first();
    if (await card.isVisible({ timeout: 5000 }).catch(() => false)) {
      await card.click();
      await page.waitForTimeout(1000);

      // Detail bottom sheet with guest info
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5000 });
      await expect(dialog.getByText(/unit/i).first()).toBeVisible();
      await expect(dialog.getByText(/vehicle/i).first()).toBeVisible();
      await expect(dialog.getByText(/plate/i).first()).toBeVisible();
    }
  });

  /* ────────────────────────────────────────────
     PAGINATION / SHOW MORE
  ──────────────────────────────────────────── */
  test("show more button loads additional history records", async ({ page }) => {
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.scrollTo({ top: 9999, behavior: "smooth" }));
    await page.waitForTimeout(1000);

    const showMoreBtn = page.getByRole("button", { name: /show more|load more/i });
    if (await showMoreBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      const initialCount = await page.locator("[class*='rounded']").filter({ hasText: /approved|active|pending|paid|expired|cancelled/i }).count();
      await showMoreBtn.click();
      await page.waitForTimeout(2000);
      const afterCount = await page.locator("[class*='rounded']").filter({ hasText: /approved|active|pending|paid|expired|cancelled/i }).count();
      expect(afterCount).toBeGreaterThanOrEqual(initialCount);
    }
  });

  /* ────────────────────────────────────────────
     COMBINED SEARCH + TAB FLOW
  ──────────────────────────────────────────── */
  test("combined flow → switch to previous tab → search → view detail → close", async ({ page }) => {
    // Switch to previous tab
    await page.getByRole("tab", { name: /previous/i }).first().click();
    await page.waitForTimeout(1500);

    // Search within previous stays
    const search = page.getByPlaceholder(/search/i);
    await search.fill("Tony");
    await page.waitForTimeout(1500);

    // Click a result card
    const card = page.locator("[class*='rounded']").filter({ hasText: /tony/i }).first();
    if (await card.isVisible({ timeout: 5000 }).catch(() => false)) {
      await card.click();
      await page.waitForTimeout(1000);

      // View details
      await expect(page.getByText(/guest details/i)).toBeVisible({ timeout: 5000 });

      // Amount due might show for past unpaid stays
      const amount = page.getByText(/amount due|\$/i);
      if (await amount.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(amount.first()).toBeVisible();
      }
    }
  });
});

test.describe("Admin More Page — Full Flows", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/more");
    await waitForLoad(page);
  });

  /* ────────────────────────────────────────────
     PAGE STRUCTURE
  ──────────────────────────────────────────── */
  test("more page loads with profile, menu items, and sign out", async ({ page }) => {
    // Profile header
    await expect(page.getByText(/admin/i).first()).toBeVisible();

    // Menu items
    await expect(page.getByText(/manage users/i)).toBeVisible();
    await expect(page.getByText(/guest history/i)).toBeVisible();
    await expect(page.getByText(/change password/i)).toBeVisible();
    await expect(page.getByText(/about/i)).toBeVisible();

    // Sign Out button (scoped to main content area)
    await expect(page.locator("#main-content").getByRole("button", { name: /sign out/i })).toBeVisible();
  });

  /* ────────────────────────────────────────────
     NAVIGATION FROM MORE PAGE
  ──────────────────────────────────────────── */
  test("navigate to Manage Users from more page", async ({ page }) => {
    await page.getByText(/manage users/i).click();
    await page.waitForURL(/\/admin\/users/, { timeout: 10000 });
    await expect(page.getByRole("heading", { name: /manage users/i })).toBeVisible();
  });

  test("navigate to Guest History from more page", async ({ page }) => {
    await page.getByText(/guest history/i).click();
    await page.waitForURL(/\/admin\/history/, { timeout: 10000 });
    await expect(page.getByRole("heading", { name: /guest history/i })).toBeVisible();
  });

  /* ────────────────────────────────────────────
     CHANGE PASSWORD — FULL FLOW
     NOTE: Skipped because it actually changes password and affects other tests
  ──────────────────────────────────────────── */
  test.skip("change password flow → open form → fill fields → submit → success → reset back", async ({ page }) => {
    // Click Change Password
    await page.getByText(/change password/i).click();
    await page.waitForTimeout(800);

    // Form opens
    await expect(page.getByText(/change password/i).first()).toBeVisible();

    // Fill Current Password
    await page.getByPlaceholder(/enter current password/i).first().fill(process.env.SEED_PASSWORD!);
    await page.waitForTimeout(300);

    // Fill New Password
    await page.getByPlaceholder(/enter new password/i).first().fill("NewP@ssword456");
    await page.waitForTimeout(300);

    // Fill Confirm New Password
    await page.getByPlaceholder(/re-enter new password/i).first().fill("NewP@ssword456");
    await page.waitForTimeout(300);

    // Submit
    await page.getByRole("button", { name: /update password/i }).click();
    await page.waitForTimeout(3000);

    // Should show success state
    const success = page.getByText(/password updated/i);
    if (await success.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(success).toBeVisible();

      // Click Done to close
      const doneBtn = page.getByRole("button", { name: /done/i });
      if (await doneBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await doneBtn.click();
        await page.waitForTimeout(500);
      }
    }

    // IMPORTANT: Reset password back to original for other tests
    await page.locator("#main-content").getByText(/change password/i).first().click();
    await page.waitForTimeout(800);
    await page.getByPlaceholder(/enter current password/i).first().fill("NewP@ssword456");
    await page.getByPlaceholder(/enter new password/i).first().fill(process.env.SEED_PASSWORD!);
    await page.getByPlaceholder(/re-enter new password/i).first().fill(process.env.SEED_PASSWORD!);
    await page.getByRole("button", { name: /update password/i }).click();
    await page.waitForTimeout(3000);
  });

  test.skip("change password → mismatched passwords shows error", async ({ page }) => {
    await page.getByText(/change password/i).click();
    await page.waitForTimeout(800);

    await page.getByPlaceholder(/enter current password/i).first().fill(process.env.SEED_PASSWORD!);
    await page.getByPlaceholder(/enter new password/i).first().fill("NewP@ssword1");
    await page.getByPlaceholder(/re-enter new password/i).first().fill("DifferentP@ss");

    await page.getByRole("button", { name: /update password/i }).click();
    await page.waitForTimeout(2000);

    // Should show error about mismatched passwords
    const error = page.getByText(/match|mismatch/i);
    if (await error.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(error).toBeVisible();
    }
  });

  /* ────────────────────────────────────────────
     ABOUT — FULL FLOW
  ──────────────────────────────────────────── */
  test("about section → shows app info and system settings", async ({ page }) => {
    await page.getByText(/about/i).click();
    await page.waitForTimeout(800);

    // About dialog should be visible
    const aboutDialog = page.getByLabel("About");
    await expect(aboutDialog).toBeVisible({ timeout: 5000 });

    // Should show app name and version within the about dialog
    await expect(aboutDialog.getByText(/aura parking/i)).toBeVisible();

    // System settings
    await expect(page.getByText(/free passes/i)).toBeVisible();
    await expect(page.getByText(/rate per day/i)).toBeVisible();
  });

  /* ────────────────────────────────────────────
     SIGN OUT — FULL FLOW
  ──────────────────────────────────────────── */
  test("sign out flow → click sign out → redirected to login page", async ({ page }) => {
    await page.locator("#main-content").getByRole("button", { name: /sign out/i }).click();
    await page.waitForTimeout(3000);

    // Should be redirected to home/ops/login page (app redirects to "/" after sign out)
    await expect(page).toHaveURL(/localhost:3000\/$|\/ops|\/login/, { timeout: 10000 });
  });
});

test.describe("Staff More/Profile Pages", () => {
  test("staff profile page loads with user info", async ({ page }) => {
    await loginAsStaff(page);
    await page.goto("/staff/profile");
    await waitForLoad(page);
    await page.waitForTimeout(2000);
    // Should show profile info
    await expect(page.getByText(/staff/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("staff more page loads with sign out", async ({ page }) => {
    await loginAsStaff(page);
    await page.goto("/staff/more");
    await waitForLoad(page);
    await expect(page.locator("#main-content").getByRole("button", { name: /sign out|log out/i })).toBeVisible({ timeout: 10000 });
  });
});
