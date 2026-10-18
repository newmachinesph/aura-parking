import { test, expect } from "@playwright/test";
import { loginAsStaff, ACCOUNTS } from "./helpers";

test.describe("DEMO: Staff Login & Dashboard", () => {
  test("staff logs in via staff login page", async ({ page }) => {
    await page.goto("/staff/login");
    await page.waitForTimeout(1500);

    // Fill staff credentials
    await page.locator("input[type='email']").first().fill(ACCOUNTS.staff.email);
    await page.waitForTimeout(500);
    await page.getByPlaceholder(/password/i).first().fill(ACCOUNTS.staff.password);
    await page.waitForTimeout(500);

    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/staff/dashboard", { timeout: 15000 });
    await page.waitForTimeout(2000);

    // Dashboard shows stats
    await expect(page.getByText(/active|expired|unauthorized/i).first()).toBeVisible();
    await page.waitForTimeout(2000);

    // Scroll to see content
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: "smooth" }));
    await page.waitForTimeout(2000);
  });
});

test.describe("DEMO: Staff Parking Patrol", () => {
  test("staff views parking page with all tabs", async ({ page }) => {
    await loginAsStaff(page);
    await page.goto("/staff/parking");
    await page.waitForTimeout(2000);

    // Show stats cards: Active, Expired, Unauth
    await page.waitForTimeout(1500);

    // Click through tabs (role="tab")
    const activeTab = page.getByRole("tab", { name: /active/i }).first();
    if (await activeTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await activeTab.click();
      await page.waitForTimeout(1500);
    }

    const expiredTab = page.getByRole("tab", { name: /expired/i }).first();
    if (await expiredTab.isVisible().catch(() => false)) {
      await expiredTab.click();
      await page.waitForTimeout(1500);
    }

    const unauthTab = page.getByRole("tab", { name: /unauthorized/i }).first();
    if (await unauthTab.isVisible().catch(() => false)) {
      await unauthTab.click();
      await page.waitForTimeout(1500);
    }

    const allTab = page.getByRole("tab", { name: /all/i }).first();
    if (await allTab.isVisible().catch(() => false)) {
      await allTab.click();
      await page.waitForTimeout(1500);
    }

    // Scroll to see vehicles
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: "smooth" }));
    await page.waitForTimeout(2000);
  });

  test("staff reports an unauthorized vehicle", async ({ page }) => {
    await loginAsStaff(page);
    await page.goto("/staff/parking");
    await page.waitForTimeout(2000);

    // Click Report button (red button with Plus icon)
    const reportBtn = page.getByRole("button", { name: /report/i }).first();
    await reportBtn.click();
    await page.waitForTimeout(1500);

    // Fill in report form
    await page.getByPlaceholder(/unk-0001/i).fill(`RPT-${Date.now().toString().slice(-4)}`);
    await page.waitForTimeout(500);

    await page.getByPlaceholder(/red sedan/i).fill("Suspicious Silver Minivan");
    await page.waitForTimeout(500);

    const locationInput = page.getByPlaceholder(/lot b|spot/i);
    if (await locationInput.isVisible().catch(() => false)) {
      await locationInput.fill("Lot A, Spot 15");
      await page.waitForTimeout(500);
    }

    const notesInput = page.getByPlaceholder(/no permit/i);
    if (await notesInput.isVisible().catch(() => false)) {
      await notesInput.fill("No parking permit visible, parked for over 3 hours");
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(1500);

    // Submit report
    await page.getByRole("button", { name: /report vehicle/i }).click();
    await page.waitForTimeout(3000);

    // Should close the form
    await page.waitForTimeout(2000);
  });

  test("staff views unauthorized tab and resolves vehicle", async ({ page }) => {
    await loginAsStaff(page);
    await page.goto("/staff/parking");
    await page.waitForTimeout(2000);

    // Go to Unauthorized tab (role="tab")
    const unauthTab = page.getByRole("tab", { name: /unauthorized/i }).first();
    if (await unauthTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await unauthTab.click();
    } else {
      // Fallback: try URL param
      await page.goto("/staff/parking?tab=unauthorized");
    }
    await page.waitForTimeout(2500);

    // Click on first unauthorized vehicle
    const vehicleCard = page.locator("[class*='rounded']").filter({ hasText: /unauthorized|unresolved/i }).first();
    if (await vehicleCard.isVisible().catch(() => false)) {
      await vehicleCard.click();
      await page.waitForTimeout(2000);

      // Show vehicle detail with recommended action
      await page.waitForTimeout(2000);

      // Click Resolve if visible
      const resolveBtn = page.getByRole("button", { name: /resolve/i });
      if (await resolveBtn.isVisible().catch(() => false)) {
        await resolveBtn.click();
        await page.waitForTimeout(1500);

        // Confirm resolve
        const confirmBtn = page.getByRole("button", { name: /confirm|resolve/i }).last();
        if (await confirmBtn.isVisible().catch(() => false)) {
          await confirmBtn.click();
          await page.waitForTimeout(3000);
        }
      }
    }
    await page.waitForTimeout(2000);
  });

  test("staff uses search to find vehicles", async ({ page }) => {
    await loginAsStaff(page);
    await page.goto("/staff/parking");
    await page.waitForTimeout(2000);

    // Use search bar
    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill("RPT");
    await page.waitForTimeout(2000);

    // Clear and search another
    await searchInput.clear();
    await page.waitForTimeout(500);

    await searchInput.fill("TEST");
    await page.waitForTimeout(2000);
  });
});
