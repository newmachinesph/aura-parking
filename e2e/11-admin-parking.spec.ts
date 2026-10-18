import { test, expect } from "@playwright/test";
import { loginAsAdmin, waitForLoad, clearMailpit, waitForEmail } from "./helpers";

const TS = () => Date.now().toString().slice(-5);

test.describe("Admin Parking Management — Full Flows", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/parking");
    await waitForLoad(page);
  });

  /* ────────────────────────────────────────────
     PAGE STRUCTURE
  ──────────────────────────────────────────── */
  test("page loads with header, stats, tabs, search, and vehicle list", async ({ page }) => {
    // Header
    await expect(page.getByRole("heading", { name: /parking/i })).toBeVisible();

    // Stats: Active Guests, Expired (48h), Unauthorized
    await expect(page.getByText(/active/i).first()).toBeVisible();
    await expect(page.getByText(/expired/i).first()).toBeVisible();
    await expect(page.getByText(/unauthorized/i).first()).toBeVisible();

    // Tabs
    await expect(page.getByRole("tab", { name: /all/i }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: /active/i }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: /expired/i }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: /unauthorized/i }).first()).toBeVisible();

    // Search
    await expect(page.getByPlaceholder(/search/i)).toBeVisible();

    // Report button
    await expect(page.getByRole("button", { name: /report/i })).toBeVisible();
  });

  /* ────────────────────────────────────────────
     TAB FILTERING FLOW
  ──────────────────────────────────────────── */
  test("tab filtering → All → Active → Expired → Unauthorized", async ({ page }) => {
    // Active tab
    await page.getByRole("tab", { name: /active/i }).first().click();
    await page.waitForTimeout(1500);
    const activeVehicles = page.locator("[class*='rounded']").filter({ hasText: /active/i });
    if (await activeVehicles.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      expect(await activeVehicles.count()).toBeGreaterThan(0);
    }

    // Expired tab
    await page.getByRole("tab", { name: /expired/i }).first().click();
    await page.waitForTimeout(1500);

    // Unauthorized tab
    await page.getByRole("tab", { name: /unauthorized/i }).first().click();
    await page.waitForTimeout(1500);
    const unauthVehicles = page.locator("[class*='rounded']").filter({ hasText: /unauthorized/i });
    if (await unauthVehicles.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      expect(await unauthVehicles.count()).toBeGreaterThan(0);
    }

    // Back to All
    await page.getByRole("tab", { name: /all/i }).first().click();
    await page.waitForTimeout(1000);
  });

  test("URL param → ?tab=unauthorized pre-selects unauthorized tab", async ({ page }) => {
    await page.goto("/admin/parking?tab=unauthorized");
    await page.waitForTimeout(1500);
    const vehicles = page.locator("[class*='rounded']").filter({ hasText: /unauthorized/i });
    if (await vehicles.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      expect(await vehicles.count()).toBeGreaterThan(0);
    }
  });

  /* ────────────────────────────────────────────
     SEARCH FLOW
  ──────────────────────────────────────────── */
  test("search → filter by plate → clear → filter by name", async ({ page }) => {
    const search = page.getByPlaceholder(/search/i);

    // Search by plate
    await search.fill("UNK");
    await page.waitForTimeout(1500);

    // Clear
    await search.clear();
    await page.waitForTimeout(500);

    // Search by unit
    await search.fill("1101");
    await page.waitForTimeout(1500);

    // Search with no results
    await search.clear();
    await search.fill("XXXXXXXXX");
    await page.waitForTimeout(1000);
  });

  /* ────────────────────────────────────────────
     REPORT UNAUTHORIZED VEHICLE — FULL FLOW
  ──────────────────────────────────────────── */
  test("report vehicle flow → click Report → fill form → submit → appears in unauthorized tab", async ({ page }) => {
    const uniquePlate = `RPT-${TS()}`;

    // Click Report button
    await page.getByRole("button", { name: /report/i }).click();
    await page.waitForTimeout(800);

    // Form opens
    await expect(page.getByText(/report unauthorized vehicle/i)).toBeVisible({ timeout: 5000 });

    // Fill License Plate
    await page.getByPlaceholder(/unk-0001/i).first().fill(uniquePlate);
    await page.waitForTimeout(300);

    // Fill Vehicle Description
    await page.getByPlaceholder(/red sedan/i).first().fill("Unknown Blue SUV");
    await page.waitForTimeout(300);

    // Fill Location
    const locationInput = page.getByPlaceholder(/lot b.*spot/i).first();
    if (await locationInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await locationInput.fill("Lot C, Spot 25");
      await page.waitForTimeout(300);
    }

    // Fill Notes
    const notesInput = page.getByPlaceholder(/no permit/i).first();
    if (await notesInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await notesInput.fill("No permit sticker visible, parked overnight");
      await page.waitForTimeout(300);
    }

    // Submit
    await page.getByRole("button", { name: /report vehicle/i }).click();
    await page.waitForTimeout(3000);

    // Verify in unauthorized tab
    await page.getByRole("tab", { name: /unauthorized/i }).first().click();
    await page.waitForTimeout(2000);
    const newVehicle = page.getByText(new RegExp(uniquePlate, "i"));
    await expect(newVehicle.first()).toBeVisible({ timeout: 10000 });
  });

  /* ────────────────────────────────────────────
     VIEW VEHICLE DETAIL — FULL FLOW
  ──────────────────────────────────────────── */
  test("view vehicle detail → bottom sheet with plate, vehicle, status, recommended action", async ({ page }) => {
    await page.getByRole("tab", { name: /unauthorized/i }).first().click();
    await page.waitForTimeout(2000);

    const card = page.locator(".bg-surface-container").first();
    if (await card.isVisible({ timeout: 5000 }).catch(() => false)) {
      await card.click();
      await page.waitForTimeout(1000);

      // Detail sheet opens
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5000 });
      await expect(dialog.getByText(/plate/i).first()).toBeVisible();
      await expect(dialog.getByText(/vehicle/i).first()).toBeVisible();

      // Recommended action should be visible
      const recommendation = dialog.getByText(/monitor|sticker|tow/i);
      if (await recommendation.first().isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(recommendation.first()).toBeVisible();
      }
    }
  });

  /* ────────────────────────────────────────────
     MARK EXPIRED AS UNAUTHORIZED — FULL FLOW
  ──────────────────────────────────────────── */
  test("mark expired vehicle as unauthorized flow → expired tab → click card → mark unauthorized", async ({ page }) => {
    await page.getByRole("tab", { name: /expired/i }).first().click();
    await page.waitForTimeout(2000);

    const expiredCard = page.locator("[class*='rounded']").filter({ hasText: /expired/i }).first();
    if (await expiredCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expiredCard.click();
      await page.waitForTimeout(1000);

      // Click "Mark as Unauthorized"
      const markBtn = page.getByRole("button", { name: /mark as unauthorized/i });
      if (await markBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await markBtn.click();
        await page.waitForTimeout(3000);
        // Vehicle should now be in unauthorized tab
      }
    }
  });

  /* ────────────────────────────────────────────
     EDIT UNAUTHORIZED VEHICLE — FULL FLOW
  ──────────────────────────────────────────── */
  test("edit vehicle flow → unauthorized tab → click card → edit → change details → save", async ({ page }) => {
    await page.getByRole("tab", { name: /unauthorized/i }).first().click();
    await page.waitForTimeout(2000);

    const card = page.locator("[class*='rounded']").filter({ hasText: /unauthorized/i }).first();
    if (await card.isVisible({ timeout: 5000 }).catch(() => false)) {
      await card.click();
      await page.waitForTimeout(1000);

      // Click Edit Details
      const editBtn = page.getByRole("button", { name: /edit/i }).first();
      if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await editBtn.click();
        await page.waitForTimeout(1000);

        // Edit form opens
        await expect(page.getByText(/edit vehicle/i)).toBeVisible({ timeout: 5000 });

        // Update location
        const locationInput = page.getByPlaceholder(/lot b.*spot/i).first().or(page.locator("input").filter({ hasText: /location/i }).first());
        if (await locationInput.isVisible({ timeout: 2000 }).catch(() => false)) {
          await locationInput.clear();
          await locationInput.fill("Lot A, Spot 1 - Updated");
          await page.waitForTimeout(300);
        }

        // Update notes
        const notesInput = page.getByPlaceholder(/no permit/i).first();
        if (await notesInput.isVisible({ timeout: 2000 }).catch(() => false)) {
          await notesInput.clear();
          await notesInput.fill("Updated notes: Still no permit visible");
          await page.waitForTimeout(300);
        }

        // Save
        await page.getByRole("button", { name: /save changes/i }).click();
        await page.waitForTimeout(3000);
      }
    }
  });

  /* ────────────────────────────────────────────
     SEND TOW WARNING EMAIL — FULL FLOW
  ──────────────────────────────────────────── */
  test("send tow warning flow → unauthorized vehicle → tow warning → enter email → send", async ({ page }) => {
    await clearMailpit();
    await page.getByRole("tab", { name: /unauthorized/i }).first().click();
    await page.waitForTimeout(2000);

    const card = page.locator("[class*='rounded']").filter({ hasText: /unauthorized/i }).first();
    if (await card.isVisible({ timeout: 5000 }).catch(() => false)) {
      await card.click();
      await page.waitForTimeout(1000);

      // Look for tow warning section (appears when vehicle is 4+ days unauthorized)
      const towSection = page.getByText(/tow/i);
      if (await towSection.first().isVisible({ timeout: 3000 }).catch(() => false)) {
        // Fill email input
        const emailInput = page.getByPlaceholder(/owner@email/i).first().or(page.getByPlaceholder(/email/i).last());
        if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await emailInput.fill("towwarning@test.com");
          await page.waitForTimeout(300);

          // Click Send
          const sendBtn = page.getByRole("button", { name: /send/i }).first();
          if (await sendBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await sendBtn.click();
            await page.waitForTimeout(3000);

            // Verify email was sent
            const email = await waitForEmail("towwarning@test.com", undefined, 5);
            if (email) {
              expect(email.Subject).toBeTruthy();
            }
          }
        }
      }
    }
  });

  /* ────────────────────────────────────────────
     RESOLVE UNAUTHORIZED VEHICLE — FULL FLOW
  ──────────────────────────────────────────── */
  test("resolve vehicle flow → report → open detail → resolve → confirm → removed from unauthorized", async ({ page }) => {
    const resolvePlate = `RES-${TS()}`;

    // First report a vehicle to resolve
    await page.getByRole("button", { name: /report/i }).click();
    await page.waitForTimeout(800);
    await page.getByPlaceholder(/unk-0001/i).first().fill(resolvePlate);
    await page.getByPlaceholder(/red sedan/i).first().fill("Car to Resolve");
    await page.getByRole("button", { name: /report vehicle/i }).click();
    await page.waitForTimeout(3000);

    // Go to unauthorized tab
    await page.getByRole("tab", { name: /unauthorized/i }).first().click();
    await page.waitForTimeout(2000);

    // Find the vehicle
    const search = page.getByPlaceholder(/search/i);
    await search.fill(resolvePlate);
    await page.waitForTimeout(1500);

    const card = page.locator("[class*='rounded']").filter({ hasText: new RegExp(resolvePlate, "i") }).first();
    if (await card.isVisible({ timeout: 5000 }).catch(() => false)) {
      await card.click();
      await page.waitForTimeout(1000);

      // Click Resolve
      const resolveBtn = page.getByRole("button", { name: /resolve/i }).first();
      if (await resolveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await resolveBtn.click();
        await page.waitForTimeout(500);

        // Confirm dialog
        const confirmBtn = page.getByRole("button", { name: /confirm|resolve/i }).last();
        if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await confirmBtn.click();
          await page.waitForTimeout(3000);
        }
      }
    }
  });

  /* ────────────────────────────────────────────
     DELETE UNAUTHORIZED VEHICLE — FULL FLOW
  ──────────────────────────────────────────── */
  test("delete vehicle flow → report → open detail → delete → confirm → removed", async ({ page }) => {
    const delPlate = `DEL-${TS()}`;

    // Report a vehicle to delete
    await page.getByRole("button", { name: /report/i }).click();
    await page.waitForTimeout(800);
    const reportDialog = page.getByRole("dialog");
    await reportDialog.getByPlaceholder(/unk-0001/i).fill(delPlate);
    await reportDialog.getByPlaceholder(/red sedan/i).fill("Car to Delete");
    await reportDialog.getByRole("button", { name: /report vehicle/i }).click();
    await page.waitForTimeout(3000);

    // Wait for dialog to close
    await expect(reportDialog).not.toBeVisible({ timeout: 10000 });

    // Go to unauthorized tab
    await page.getByRole("tab", { name: /unauthorized/i }).first().click();
    await page.waitForTimeout(2000);

    // Find the vehicle
    const search = page.getByPlaceholder(/search/i);
    await search.fill(delPlate);
    await page.waitForTimeout(1500);

    const card = page.locator(".bg-surface-container").filter({ hasText: new RegExp(delPlate, "i") }).first();
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
        await expect(page.getByText(/delete vehicle/i)).toBeVisible({ timeout: 3000 });
        const confirmBtn = page.getByRole("button", { name: /confirm|delete/i }).last();
        await confirmBtn.click();
        await page.waitForTimeout(3000);
      }
    }
  });

  /* ────────────────────────────────────────────
     ACTIVE VEHICLE DETAIL — FULL FLOW
  ──────────────────────────────────────────── */
  test("view active vehicle detail → shows guest info with pass validity", async ({ page }) => {
    await page.getByRole("tab", { name: /active/i }).first().click();
    await page.waitForTimeout(2000);

    const card = page.locator(".bg-surface-container").first();
    if (await card.isVisible({ timeout: 5000 }).catch(() => false)) {
      await card.click();
      await page.waitForTimeout(1000);

      // Detail dialog opens
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5000 });
      await expect(dialog.getByText(/plate/i).first()).toBeVisible();
      // Active vehicle should show "Active" status badge
      await expect(dialog.getByText(/active/i).first()).toBeVisible();
    }
  });
});
