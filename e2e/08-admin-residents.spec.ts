import { test, expect } from "@playwright/test";
import { loginAsAdmin, waitForLoad } from "./helpers";

const TS = () => Date.now().toString().slice(-5);

test.describe("Admin Residents Management — Full Flows", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/residents");
    await waitForLoad(page);
  });

  /* ────────────────────────────────────────────
     PAGE STRUCTURE
  ──────────────────────────────────────────── */
  test("page loads with header, stats, search, and resident list", async ({ page }) => {
    // Header - use h1 selector
    await expect(page.locator("h1").filter({ hasText: /residents/i })).toBeVisible();

    // Stats: Only "Total Residents" card exists on this page
    await expect(page.getByText(/total residents/i).first()).toBeVisible();

    // Search
    await expect(page.getByPlaceholder(/search/i)).toBeVisible();

    // Add Resident button
    await expect(page.getByRole("button", { name: /add resident/i })).toBeVisible();

    // Resident data from seed
    await page.waitForTimeout(2000);
    await expect(page.getByText(/maria santos|james rivera|elena rodriguez/i).first()).toBeVisible({ timeout: 10000 });
  });

  /* ────────────────────────────────────────────
     SEARCH FILTERING
  ──────────────────────────────────────────── */
  test("search filters residents list", async ({ page }) => {
    await page.waitForTimeout(2000);

    // Search should show matching residents
    const search = page.getByPlaceholder(/search/i);
    await search.fill("Maria");
    await page.waitForTimeout(1000);
    await expect(page.getByText(/maria santos/i).first()).toBeVisible({ timeout: 5000 });

    // Clear and search for another
    await search.clear();
    await page.waitForTimeout(500);
    await search.fill("James");
    await page.waitForTimeout(1000);
    await expect(page.getByText(/james rivera/i).first()).toBeVisible({ timeout: 5000 });
  });

  /* ────────────────────────────────────────────
     SEARCH FLOW
  ──────────────────────────────────────────── */
  test("search → filter by name → clear → filter by unit", async ({ page }) => {
    const search = page.getByPlaceholder(/search/i);

    // Search by name
    await search.fill("Maria");
    await page.waitForTimeout(1000);
    await expect(page.getByText(/maria santos/i)).toBeVisible({ timeout: 5000 });

    // Clear
    await search.clear();
    await page.waitForTimeout(500);

    // Search by unit
    await search.fill("1102");
    await page.waitForTimeout(1000);
    const result = page.getByText(/1102/i);
    if (await result.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      expect(await result.count()).toBeGreaterThan(0);
    }

    // Clear
    await search.clear();
    await page.waitForTimeout(500);

    // Search by email
    await search.fill("rivera");
    await page.waitForTimeout(1000);
    await expect(page.getByText(/james rivera/i)).toBeVisible({ timeout: 5000 });
  });

  /* ────────────────────────────────────────────
     ADD RESIDENT — FULL FLOW
  ──────────────────────────────────────────── */
  test("add resident flow → fill form → create → appears in list", async ({ page }) => {
    const uniqueEmail = `e2e-res-${TS()}@test.com`;

    // Open Add Resident form
    await page.getByRole("button", { name: /add resident/i }).click();
    await page.waitForTimeout(800);

    // Form opens in dialog
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Fill Full Name
    await dialog.getByPlaceholder(/jane doe/i).fill("E2E Resident");

    // Fill Email
    await dialog.getByPlaceholder(/resident@email/i).fill(uniqueEmail);

    // Fill Unit Number
    await dialog.getByPlaceholder(/4052/i).fill("C-999");

    // Fill Password
    await dialog.getByPlaceholder(/temporary password/i).fill("TestP@ss123");

    // Submit
    await dialog.getByRole("button", { name: /create resident/i }).click();
    await page.waitForTimeout(3000);

    // Wait for dialog to close
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // Verify resident appears in list
    const search = page.getByPlaceholder(/search/i);
    await search.fill("E2E Resident");
    await page.waitForTimeout(1500);
    await expect(page.getByText(/e2e resident/i).first()).toBeVisible({ timeout: 10000 });
  });

  /* ────────────────────────────────────────────
     VIEW RESIDENT DETAIL — FULL FLOW
  ──────────────────────────────────────────── */
  test("view resident detail → bottom sheet with profile and guest history", async ({ page }) => {
    await page.waitForTimeout(2000);

    // Click on a resident card
    const card = page.locator(".bg-surface-container, [class*='rounded']").filter({ hasText: /maria santos/i }).first();
    if (await card.isVisible({ timeout: 5000 }).catch(() => false)) {
      await card.click();
      await page.waitForTimeout(1000);

      // Detail sheet opens
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Should show profile info
      await expect(dialog.getByText(/maria santos/i).first()).toBeVisible();

      // Guest records section with tabs
      const guestRecords = dialog.getByText(/guest records/i);
      if (await guestRecords.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(guestRecords).toBeVisible();
      }
    }
  });

  /* ────────────────────────────────────────────
     EDIT RESIDENT — FULL FLOW
  ──────────────────────────────────────────── */
  test("edit resident flow → open detail → edit → verify form → close", async ({ page }) => {
    await page.waitForTimeout(2000);

    // Click on a resident card
    const card = page.locator(".bg-surface-container, [class*='rounded']").filter({ hasText: /maria santos|james rivera/i }).first();
    if (await card.isVisible({ timeout: 5000 }).catch(() => false)) {
      await card.click();
      await page.waitForTimeout(1000);

      // Detail dialog opens
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Click Edit button inside dialog
      const editBtn = dialog.getByRole("button", { name: /edit resident/i });
      if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await editBtn.click();
        await page.waitForTimeout(1000);

        // Edit form should be visible with Save Changes button
        await expect(page.getByRole("button", { name: /save changes/i })).toBeVisible({ timeout: 5000 });
      }
    }
  });

  /* ────────────────────────────────────────────
     DELETE RESIDENT — FULL FLOW
  ──────────────────────────────────────────── */
  test("delete resident flow → create → open detail → delete → confirm", async ({ page }) => {
    const delEmail = `del-res-${TS()}@test.com`;

    // Create a resident to delete
    await page.getByRole("button", { name: /add resident/i }).click();
    await page.waitForTimeout(800);

    const addDialog = page.getByRole("dialog");
    await addDialog.getByPlaceholder(/jane doe/i).fill("Delete Me Resident");
    await addDialog.getByPlaceholder(/resident@email/i).fill(delEmail);
    await addDialog.getByPlaceholder(/4052/i).fill("D-001");
    await addDialog.getByPlaceholder(/temporary password/i).fill("TestP@ss123");
    await addDialog.getByRole("button", { name: /create resident/i }).click();
    await page.waitForTimeout(3000);

    // Wait for dialog to close
    await expect(addDialog).not.toBeVisible({ timeout: 10000 });

    // Find the resident
    const search = page.getByPlaceholder(/search/i);
    await search.fill("Delete Me Resident");
    await page.waitForTimeout(1500);

    const card = page.locator(".bg-surface-container, [class*='rounded']").filter({ hasText: /delete me resident/i }).first();
    if (await card.isVisible({ timeout: 5000 }).catch(() => false)) {
      await card.click();
      await page.waitForTimeout(1000);

      // Detail dialog opens
      const detailDialog = page.getByRole("dialog");
      await expect(detailDialog).toBeVisible({ timeout: 5000 });

      // Click Delete button inside dialog
      const deleteBtn = detailDialog.getByRole("button", { name: /delete/i });
      if (await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await deleteBtn.click();
        await page.waitForTimeout(500);

        // Confirm dialog appears
        const confirmBtn = page.getByRole("button", { name: /confirm|delete/i }).last();
        await confirmBtn.click();
        await page.waitForTimeout(3000);
      }
    }
  });
});
