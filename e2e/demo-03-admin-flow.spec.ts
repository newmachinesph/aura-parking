import { test, expect } from "@playwright/test";
import { loginAsAdmin, ACCOUNTS, pickDateRange } from "./helpers";

test.describe("DEMO: Admin Login & Dashboard", () => {
  test("admin logs in via admin login page", async ({ page }) => {
    await page.goto("/admin/login");
    await page.waitForTimeout(1500);

    // Fill admin credentials
    await page.locator("input[type='email']").first().fill(ACCOUNTS.admin.email);
    await page.waitForTimeout(500);
    await page.getByPlaceholder(/password/i).first().fill(ACCOUNTS.admin.password);
    await page.waitForTimeout(500);

    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/admin/dashboard", { timeout: 15000 });
    await page.waitForTimeout(2000);

    // Dashboard shows stat cards: Residents, Units, Guests
    await expect(page.getByText(/residents/i).first()).toBeVisible();
    await expect(page.getByText(/units/i).first()).toBeVisible();
    await expect(page.getByText(/guests/i).first()).toBeVisible();
    await page.waitForTimeout(1500);

    // Default view is residents list
    await page.waitForTimeout(1500);

    // Scroll to see content
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: "smooth" }));
    await page.waitForTimeout(2000);
  });
});

test.describe("DEMO: Admin Guest Management", () => {
  test("admin views and manages guests page", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/guests");
    await page.waitForTimeout(2000);

    // Show page header and stats
    await page.waitForTimeout(1500);

    // Show tabs using role="tab": All, Active, Pending, Unpaid, Paid
    await page.waitForTimeout(1000);

    // Click Pending tab
    await page.getByRole("tab", { name: /pending/i }).first().click();
    await page.waitForTimeout(2000);

    // Click Active tab
    await page.getByRole("tab", { name: /active/i }).first().click();
    await page.waitForTimeout(2000);

    // Click Upcoming tab (no "All" tab exists in this page)
    await page.getByRole("tab", { name: /upcoming/i }).first().click();
    await page.waitForTimeout(1500);

    // Scroll to see guest list
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: "smooth" }));
    await page.waitForTimeout(2000);
  });

  test("admin adds a guest for a unit", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/guests");
    await page.waitForTimeout(2000);

    // Click Add Guest button
    await page.getByRole("button", { name: /add guest/i }).first().click();
    await page.waitForTimeout(1500);

    // Fill in the add guest form
    const unitInput = page.getByPlaceholder(/unit|4052/i).first();
    await unitInput.fill("1102");
    await page.waitForTimeout(500);

    await page.getByPlaceholder(/first last/i).first().fill("Admin Added Guest");
    await page.waitForTimeout(500);

    await page.getByPlaceholder(/guest@email/i).first().fill("admin-added@test.com");
    await page.waitForTimeout(500);

    await page.getByPlaceholder(/abc-1234/i).first().fill("ADM-9999");
    await page.waitForTimeout(500);

    await page.getByPlaceholder(/toyota/i).first().fill("Black Tesla Model 3");
    await page.waitForTimeout(500);

    // Pick dates using custom DateRangePicker
    await pickDateRange(page, 0, 3);
    await page.waitForTimeout(1500);

    // Submit
    await page.getByRole("button", { name: /save guest/i }).click();
    await page.waitForTimeout(3000);

    // Show success
    await page.waitForTimeout(2000);
  });

  test("admin approves a pending guest", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/guests?tab=pending");
    await page.waitForTimeout(2500);

    // Click on first pending guest
    const pendingCard = page.locator("[class*='rounded']").filter({ hasText: /pending/i }).first();
    if (await pendingCard.isVisible().catch(() => false)) {
      await pendingCard.click();
      await page.waitForTimeout(2000);

      // Show detail sheet
      await page.waitForTimeout(1500);

      // Click Approve
      const approveBtn = page.getByRole("button", { name: /approve/i }).first();
      if (await approveBtn.isVisible().catch(() => false)) {
        await approveBtn.click();
        await page.waitForTimeout(3000);
      }
    }
    await page.waitForTimeout(2000);
  });

  test("admin searches guests by plate", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/guests");
    await page.waitForTimeout(2000);

    // Use search bar
    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill("ADM");
    await page.waitForTimeout(2000);

    // Clear search
    await searchInput.clear();
    await page.waitForTimeout(1000);

    await searchInput.fill("maria");
    await page.waitForTimeout(2000);
  });
});

test.describe("DEMO: Admin User Management", () => {
  test("admin views users and activates an account", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/users");
    await page.waitForTimeout(2000);

    // Show user management page
    await expect(page.getByRole("heading", { name: /manage users/i })).toBeVisible();
    await page.waitForTimeout(1500);

    // Show stats: Admins, Staff, Pending, Total
    await page.waitForTimeout(1000);

    // Click Pending tab to see inactive users (uses role="tab")
    await page.getByRole("tab", { name: /pending/i }).first().click();
    await page.waitForTimeout(2500);

    // Click on a pending user to view details
    const pendingCard = page.locator("[class*='rounded']").filter({ hasText: /inactive/i }).first();
    if (await pendingCard.isVisible().catch(() => false)) {
      await pendingCard.click();
      await page.waitForTimeout(2000);

      // Show user detail sheet
      await page.waitForTimeout(1500);

      // Click "Activate Account" button inside the BottomSheet (not the small icon in the card list)
      const activateBtn = page.getByRole("button", { name: /activate account/i });
      if (await activateBtn.isVisible().catch(() => false)) {
        await activateBtn.click();
        await page.waitForTimeout(1500);

        // Confirm activation
        const confirmBtn = page.getByRole("button", { name: /confirm/i }).first();
        if (await confirmBtn.isVisible().catch(() => false)) {
          await confirmBtn.click();
          await page.waitForTimeout(3000);
        }
      }
    }
    await page.waitForTimeout(2000);
  });

  test("admin adds a new staff user", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/users");
    await page.waitForTimeout(2000);

    // Click Add User
    await page.getByRole("button", { name: /add user/i }).click();
    await page.waitForTimeout(1500);

    // Select Staff role
    const staffRole = page.getByRole("button", { name: /^staff$/i }).first();
    if (await staffRole.isVisible().catch(() => false)) {
      await staffRole.click();
      await page.waitForTimeout(800);
    }

    // Fill form
    await page.getByPlaceholder(/jane doe/i).fill("New Staff Member");
    await page.waitForTimeout(500);

    await page.getByRole("textbox", { name: "Email", exact: true }).fill(`newstaff-${Date.now()}@aura.com`);
    await page.waitForTimeout(500);

    await page.getByPlaceholder(/••••/i).fill("StaffP@ss123");
    await page.waitForTimeout(1000);

    // Submit
    await page.getByRole("button", { name: /create/i }).last().click();
    await page.waitForTimeout(3000);

    await page.waitForTimeout(2000);
  });
});

test.describe("DEMO: Admin Residents & Units", () => {
  test("admin views residents via dashboard", async ({ page }) => {
    await loginAsAdmin(page);
    await page.waitForTimeout(2000);

    // Dashboard default is residents view
    await page.waitForTimeout(1500);

    // Scroll to see all residents
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: "smooth" }));
    await page.waitForTimeout(2000);
  });

  test("admin switches to units view via dashboard", async ({ page }) => {
    await loginAsAdmin(page);
    await page.waitForTimeout(2000);

    // Click Units stat card
    const unitsCard = page.locator("[class*='rounded']").filter({ hasText: /units/i }).first();
    await unitsCard.click();
    await page.waitForTimeout(2000);

    // Scroll to see units
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: "smooth" }));
    await page.waitForTimeout(2000);
  });
});

test.describe("DEMO: Admin Parking Management", () => {
  test("admin views parking page and unauthorized vehicles", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/parking");
    await page.waitForTimeout(2000);

    // Show parking page with tabs (role="tab")
    await page.waitForTimeout(1500);

    // Click Unauthorized tab
    const unauthorizedTab = page.getByRole("tab", { name: /unauthorized/i }).first();
    if (await unauthorizedTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await unauthorizedTab.click();
      await page.waitForTimeout(2500);
    }

    // Scroll down
    await page.evaluate(() => window.scrollTo({ top: 300, behavior: "smooth" }));
    await page.waitForTimeout(2000);

    // Click All tab
    const allTab = page.getByRole("tab", { name: /all/i }).first();
    if (await allTab.isVisible().catch(() => false)) {
      await allTab.click();
      await page.waitForTimeout(2000);
    }
  });
});
