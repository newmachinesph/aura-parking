import { test, expect } from "@playwright/test";
import { loginAsResident, ACCOUNTS } from "./helpers";

test.describe("Resident Passes Page", () => {
  test("passes page shows pass balance", async ({ page }) => {
    await loginAsResident(page, ACCOUNTS.residentWithBonus);
    await page.goto("/dashboard/passes");
    await page.waitForLoadState("networkidle").catch(() => {});

    // Should show pass balance section
    await expect(page.getByText(/pass balance|free night|guest pass/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("passes page shows buy buttons", async ({ page }) => {
    await loginAsResident(page);
    await page.goto("/dashboard/passes");
    await page.waitForLoadState("networkidle").catch(() => {});

    // Should show purchase options - buttons say "Buy" and bundles show "3-Pass Bundle" / "5-Pass Bundle"
    await expect(page.getByText(/3-Pass Bundle/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/5-Pass Bundle/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Buy" }).first()).toBeVisible();
  });

  test("passes page shows monthly breakdown", async ({ page }) => {
    await loginAsResident(page, ACCOUNTS.residentWithBonus);
    await page.goto("/dashboard/passes");
    await page.waitForLoadState("networkidle").catch(() => {});

    // Sarah Johnson has bonus passes (bought 3-pack) - should show some pass info
    await expect(page.getByText(/bonus|monthly|remaining/i).first()).toBeVisible({ timeout: 10000 });
  });
});
