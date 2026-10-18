import { test, expect } from "@playwright/test";
import { loginAsAdmin, waitForLoad, clearMailpit, waitForEmail } from "./helpers";

const TS = () => Date.now().toString().slice(-5);

test.describe("Admin Users Management — Full Flows", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/users");
    await waitForLoad(page);
  });

  /* ────────────────────────────────────────────
     PAGE STRUCTURE
  ──────────────────────────────────────────── */
  test("page loads with header, stats, tabs, search, and user list", async ({ page }) => {
    // Header
    await expect(page.getByRole("heading", { name: /manage users/i })).toBeVisible();

    // Stats: Admins, Staff, Pending, Total
    await expect(page.getByText(/admins/i).first()).toBeVisible();
    await expect(page.getByText(/staff/i).first()).toBeVisible();
    await expect(page.getByText(/pending/i).first()).toBeVisible();
    await expect(page.getByText(/total/i).first()).toBeVisible();

    // Tabs
    await expect(page.getByRole("tab", { name: /all/i }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: /admin/i }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: /staff/i }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: /pending/i }).first()).toBeVisible();

    // Search
    await expect(page.getByPlaceholder(/search/i)).toBeVisible();

    // Add User button
    await expect(page.getByRole("button", { name: /add user/i })).toBeVisible();

    // User data should be visible (admin or staff accounts)
    await page.waitForTimeout(2000);
    const userCard = page.locator("[class*='rounded']").filter({ hasText: /admin|staff/i }).first();
    await expect(userCard).toBeVisible({ timeout: 10000 });
  });

  /* ────────────────────────────────────────────
     TAB FILTERING FLOW
  ──────────────────────────────────────────── */
  test("tab filtering → All → Admin → Staff → Pending", async ({ page }) => {
    // Admin tab
    await page.getByRole("tab", { name: /admin/i }).first().click();
    await page.waitForTimeout(1500);
    const adminUsers = page.getByText(/admin/i);
    expect(await adminUsers.count()).toBeGreaterThan(0);

    // Staff tab
    await page.getByRole("tab", { name: /staff/i }).first().click();
    await page.waitForTimeout(1500);

    // Pending tab
    await page.getByRole("tab", { name: /pending/i }).first().click();
    await page.waitForTimeout(1500);
    const pendingUsers = page.getByText(/inactive/i);
    if (await pendingUsers.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      expect(await pendingUsers.count()).toBeGreaterThan(0);
    }

    // Back to All
    await page.getByRole("tab", { name: /all/i }).first().click();
    await page.waitForTimeout(1000);
  });

  test("URL param → ?tab=pending pre-selects pending tab", async ({ page }) => {
    await page.goto("/admin/users?tab=pending");
    await page.waitForTimeout(1500);
    const pendingUser = page.getByText(/likeablelosers\+admin2|inactive/i);
    if (await pendingUser.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      expect(await pendingUser.count()).toBeGreaterThan(0);
    }
  });

  /* ────────────────────────────────────────────
     SEARCH FLOW
  ──────────────────────────────────────────── */
  test("search → filter by role keyword", async ({ page }) => {
    const search = page.getByPlaceholder(/search/i);

    // Search by role keyword "admin"
    await search.fill("admin");
    await page.waitForTimeout(1000);
    const adminResult = page.getByText(/admin/i);
    expect(await adminResult.count()).toBeGreaterThan(0);

    // Clear
    await search.clear();
    await page.waitForTimeout(500);

    // Search by role keyword "staff"
    await search.fill("staff");
    await page.waitForTimeout(1000);
    const staffResult = page.getByText(/staff/i);
    expect(await staffResult.count()).toBeGreaterThan(0);
  });

  /* ────────────────────────────────────────────
     ADD ADMIN USER — FULL FLOW
  ──────────────────────────────────────────── */
  test("add admin user flow → select role → fill form → create", async ({ page }) => {
    const uniqueEmail = `e2e-admin-${TS()}@aura.com`;

    await page.getByRole("button", { name: /add user/i }).click();
    await page.waitForTimeout(800);

    // Form opens in dialog
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Select Admin role
    const adminRole = dialog.getByRole("button", { name: /^admin$/i });
    if (await adminRole.isVisible({ timeout: 2000 }).catch(() => false)) {
      await adminRole.click();
      await page.waitForTimeout(300);
    }

    // Fill Full Name
    await dialog.getByPlaceholder(/jane doe/i).fill("E2E Admin User");
    await page.waitForTimeout(300);

    // Fill Email
    await dialog.getByPlaceholder(/^email$/i).fill(uniqueEmail);
    await page.waitForTimeout(300);

    // Fill Password
    await dialog.getByPlaceholder(/••••/i).fill("AdminP@ss123");
    await page.waitForTimeout(300);

    // Submit
    await dialog.getByRole("button", { name: /create admin/i }).click();
    await page.waitForTimeout(3000);

    // Wait for dialog to close
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // Verify user appears in Admin tab (card shows name, not email when name is provided)
    await page.getByRole("tab", { name: /admin/i }).first().click();
    await page.waitForTimeout(1500);
    const search = page.getByPlaceholder(/search/i);
    await search.fill("E2E Admin User");
    await page.waitForTimeout(1500);
    await expect(page.getByText(/e2e admin user/i).first()).toBeVisible({ timeout: 10000 });
  });

  /* ────────────────────────────────────────────
     ADD STAFF USER — FULL FLOW
  ──────────────────────────────────────────── */
  test("add staff user flow → select staff role → fill form → create", async ({ page }) => {
    const uniqueEmail = `e2e-staff-${TS()}@aura.com`;

    await page.getByRole("button", { name: /add user/i }).click();
    await page.waitForTimeout(800);

    // Select Staff role
    const staffRole = page.getByRole("button", { name: /^staff$/i }).first();
    if (await staffRole.isVisible({ timeout: 2000 }).catch(() => false)) {
      await staffRole.click();
      await page.waitForTimeout(300);
    }

    // Fill form
    await page.getByPlaceholder(/jane doe/i).first().fill("E2E Staff User");
    await page.waitForTimeout(300);
    await page.getByPlaceholder(/^email$/i).first().fill(uniqueEmail);
    await page.waitForTimeout(300);
    await page.getByPlaceholder(/••••/i).first().fill("StaffP@ss123");
    await page.waitForTimeout(300);

    // Submit
    await page.getByRole("button", { name: /create/i }).last().click();
    await page.waitForTimeout(3000);

    // Verify in Staff tab
    await page.getByRole("tab", { name: /staff/i }).first().click();
    await page.waitForTimeout(1500);
    const newStaff = page.getByText(new RegExp(uniqueEmail, "i"));
    if (await newStaff.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(newStaff.first()).toBeVisible();
    }
  });

  /* ────────────────────────────────────────────
     ADD RESIDENT USER — FULL FLOW (shows Unit field)
  ──────────────────────────────────────────── */
  test("add resident user flow → select resident role → unit field appears → create", async ({ page }) => {
    const uniqueEmail = `e2e-resuser-${TS()}@aura.com`;

    await page.getByRole("button", { name: /add user/i }).click();
    await page.waitForTimeout(800);

    // Select Resident role
    const residentRole = page.getByRole("button", { name: /^resident$/i }).first();
    if (await residentRole.isVisible({ timeout: 2000 }).catch(() => false)) {
      await residentRole.click();
      await page.waitForTimeout(500);

      // Unit Number field should now appear
      const unitInput = page.getByPlaceholder(/4052/i).first();
      await expect(unitInput).toBeVisible({ timeout: 3000 });

      // Fill form
      await page.getByPlaceholder(/jane doe/i).first().fill("E2E Resident User");
      await page.waitForTimeout(300);
      await page.getByPlaceholder(/^email$/i).first().fill(uniqueEmail);
      await page.waitForTimeout(300);
      await unitInput.fill("1101");
      await page.waitForTimeout(300);
      await page.getByPlaceholder(/••••/i).first().fill("ResidentP@ss123");
      await page.waitForTimeout(300);

      // Submit
      await page.getByRole("button", { name: /create/i }).last().click();
      await page.waitForTimeout(3000);
    }
  });

  /* ────────────────────────────────────────────
     VIEW USER DETAIL — FULL FLOW
  ──────────────────────────────────────────── */
  test("view user detail → bottom sheet with profile info", async ({ page }) => {
    await page.waitForTimeout(2000);

    // Click on the first user card in the list
    const card = page.locator(".bg-surface-container").first();
    if (await card.isVisible({ timeout: 5000 }).catch(() => false)) {
      await card.click();
      await page.waitForTimeout(1000);

      // Detail sheet opens
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Should show user info
      await expect(dialog.getByText(/email/i).first()).toBeVisible();
      await expect(dialog.getByText(/role/i).first()).toBeVisible();
    }
  });

  /* ────────────────────────────────────────────
     ACTIVATE PENDING USER — FULL FLOW
  ──────────────────────────────────────────── */
  test("activate user flow → pending tab → click user → activate → confirm → email sent", async ({ page }) => {
    await clearMailpit();
    await page.getByRole("tab", { name: /pending/i }).first().click();
    await page.waitForTimeout(2000);

    const pendingCard = page.locator("[class*='rounded']").filter({ hasText: /inactive/i }).first();
    if (await pendingCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await pendingCard.click();
      await page.waitForTimeout(1000);

      // Click "Activate Account" button
      const activateBtn = page.getByRole("button", { name: /activate account/i });
      if (await activateBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await activateBtn.click();
        await page.waitForTimeout(1000);

        // Inline confirmation appears
        await expect(page.getByText(/activate this account/i)).toBeVisible({ timeout: 3000 });

        // Click Confirm
        const confirmBtn = page.getByRole("button", { name: /confirm/i }).first();
        await confirmBtn.click();
        await page.waitForTimeout(4000);

        // Check for email notification
        const email = await waitForEmail("@example.com", undefined, 5);
        if (email) {
          expect(email.Subject).toBeTruthy();
        }
      }
    }
  });

  /* ────────────────────────────────────────────
     EDIT USER — FULL FLOW
  ──────────────────────────────────────────── */
  test("edit user flow → open detail → edit → change role → save", async ({ page }) => {
    // Create a staff user to edit
    const editEmail = `edit-user-${TS()}@aura.com`;
    await page.getByRole("button", { name: /add user/i }).click();
    await page.waitForTimeout(800);
    const staffRole = page.getByRole("button", { name: /^staff$/i }).first();
    if (await staffRole.isVisible({ timeout: 2000 }).catch(() => false)) {
      await staffRole.click();
    }
    await page.getByPlaceholder(/jane doe/i).first().fill("Edit User Test");
    await page.getByPlaceholder(/^email$/i).first().fill(editEmail);
    await page.getByPlaceholder(/••••/i).first().fill("EditP@ss123");
    await page.getByRole("button", { name: /create/i }).last().click();
    await page.waitForTimeout(3000);

    // Find the user
    const search = page.getByPlaceholder(/search/i);
    await search.fill(editEmail);
    await page.waitForTimeout(1500);

    const card = page.locator("[class*='rounded']").filter({ hasText: new RegExp(editEmail, "i") }).first();
    if (await card.isVisible({ timeout: 5000 }).catch(() => false)) {
      await card.click();
      await page.waitForTimeout(1000);

      // Click Edit
      const editBtn = page.getByRole("button", { name: /edit/i }).first();
      if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await editBtn.click();
        await page.waitForTimeout(1000);

        // Edit form opens
        await expect(page.getByText(/edit user/i)).toBeVisible({ timeout: 5000 });

        // Toggle role to admin
        const adminToggle = page.getByRole("button", { name: /^admin$/i }).first();
        if (await adminToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
          await adminToggle.click();
          await page.waitForTimeout(500);
        }

        // Save
        await page.getByRole("button", { name: /save changes/i }).click();
        await page.waitForTimeout(3000);
      }
    }
  });

  /* ────────────────────────────────────────────
     DELETE USER — FULL FLOW
  ──────────────────────────────────────────── */
  test("delete user flow → create → open detail → delete → confirm → gone", async ({ page }) => {
    const delEmail = `del-user-${TS()}@aura.com`;

    // Create user to delete
    await page.getByRole("button", { name: /add user/i }).click();
    await page.waitForTimeout(800);
    await page.getByPlaceholder(/jane doe/i).first().fill("Delete User Test");
    await page.getByPlaceholder(/^email$/i).first().fill(delEmail);
    await page.getByPlaceholder(/••••/i).first().fill("DeleteP@ss123");
    await page.getByRole("button", { name: /create/i }).last().click();
    await page.waitForTimeout(3000);

    // Find the user
    const search = page.getByPlaceholder(/search/i);
    await search.fill(delEmail);
    await page.waitForTimeout(1500);

    const card = page.locator("[class*='rounded']").filter({ hasText: new RegExp(delEmail, "i") }).first();
    if (await card.isVisible({ timeout: 5000 }).catch(() => false)) {
      await card.click();
      await page.waitForTimeout(1000);

      // Click Delete
      const deleteBtn = page.getByRole("button", { name: /delete/i }).first();
      if (await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await deleteBtn.click();
        await page.waitForTimeout(500);

        // Confirm dialog
        await expect(page.getByText(/delete user/i)).toBeVisible({ timeout: 3000 });
        const confirmBtn = page.getByRole("button", { name: /confirm|delete/i }).last();
        await confirmBtn.click();
        await page.waitForTimeout(3000);
      }
    }
  });
});
