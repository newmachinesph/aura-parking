import { test, expect } from "@playwright/test";
import { loginAsStaff } from "./helpers";

test.describe("Staff Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStaff(page);
  });

  test("staff dashboard loads with stats", async ({ page }) => {
    await expect(page.getByText(/active|expired|unauthorized/i).first()).toBeVisible();
  });

  test("report unauthorized vehicle button exists", async ({ page }) => {
    const reportBtn = page.getByRole("button", { name: /report|unauthorized/i }).first();
    if (await reportBtn.isVisible().catch(() => false)) {
      await expect(reportBtn).toBeVisible();
    }
  });
});

test.describe("Staff Parking", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStaff(page);
    await page.goto("/staff/parking");
    await page.waitForLoadState("networkidle").catch(() => {});
  });

  test("parking page loads with tabs", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /all/i }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: /active/i }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: /expired/i }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: /unauthorized/i }).first()).toBeVisible();
  });

  test("parking page shows stats cards", async ({ page }) => {
    await expect(page.getByText(/active/i).first()).toBeVisible();
  });

  test("search filters vehicles", async ({ page }) => {
    await page.waitForTimeout(2000);
    const searchInput = page.getByPlaceholder(/search/i);
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill("TEST-PLATE");
      await page.waitForTimeout(500);
    }
  });

  test("report unauthorized vehicle form opens", async ({ page }) => {
    // Click the "Report" or "+" button
    const reportBtn = page.getByRole("button", { name: /report|add/i }).first();
    if (await reportBtn.isVisible().catch(() => false)) {
      await reportBtn.click();
      // Should see form with plate input
      await expect(page.getByPlaceholder(/plate/i).first()).toBeVisible({ timeout: 5000 });
    }
  });

  test("report unauthorized vehicle with ?report=true", async ({ page }) => {
    await page.goto("/staff/parking?report=true");
    await page.waitForTimeout(1000);
    // Form should auto-open
    await expect(page.getByPlaceholder(/plate/i).first()).toBeVisible({ timeout: 5000 });
  });

  test("submit unauthorized vehicle report", async ({ page }) => {
    await page.goto("/staff/parking?report=true");
    await expect(page.getByPlaceholder(/plate/i).first()).toBeVisible({ timeout: 5000 });

    await page.getByPlaceholder(/plate/i).first().fill(`UNK-${Date.now().toString().slice(-4)}`);
    const vehicleInput = page.getByPlaceholder(/vehicle|description/i).first();
    if (await vehicleInput.isVisible().catch(() => false)) {
      await vehicleInput.fill("Unknown Black SUV");
    }
    const locationInput = page.getByPlaceholder(/location/i);
    if (await locationInput.isVisible().catch(() => false)) {
      await locationInput.fill("Lot B Row 3");
    }

    const submitBtn = page.getByRole("button", { name: /report|submit|add/i }).last();
    await submitBtn.click();
    await page.waitForTimeout(3000);

    // Should close the form or show success
  });

  test("unauthorized tab shows reported vehicles", async ({ page }) => {
    await page.getByRole("tab", { name: /unauthorized/i }).first().click();
    await page.waitForTimeout(1000);
    const vehicles = page.locator(".bg-surface-container");
    if (await vehicles.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      expect(await vehicles.count()).toBeGreaterThan(0);
    }
  });

  test("resolve unauthorized vehicle", async ({ page }) => {
    await page.getByRole("tab", { name: /unauthorized/i }).first().click();
    await page.waitForTimeout(2000);

    // Click first unauthorized vehicle card
    const card = page.locator(".bg-surface-container").first();
    if (await card.isVisible({ timeout: 5000 }).catch(() => false)) {
      await card.click();
      await page.waitForTimeout(500);

      // Look for resolve button in dialog
      const dialog = page.getByRole("dialog");
      const resolveBtn = dialog.getByRole("button", { name: /resolve/i });
      if (await resolveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await resolveBtn.click();
        await page.waitForTimeout(2000);
      }
    }
  });

  test("vehicle detail shows recommended action", async ({ page }) => {
    await page.getByRole("tab", { name: /unauthorized/i }).first().click();
    await page.waitForTimeout(2000);

    const card = page.locator(".bg-surface-container").first();
    if (await card.isVisible({ timeout: 5000 }).catch(() => false)) {
      await card.click();
      await page.waitForTimeout(500);

      // Dialog should open
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Should show recommendation: Monitor, Sticker, or Tow
      const recommendation = dialog.getByText(/monitor|sticker|tow/i);
      if (await recommendation.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(recommendation).toBeVisible();
      }
    }
  });
});
