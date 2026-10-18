import { test, expect } from "@playwright/test";
import { loginAsAdmin, ACCOUNTS } from "./helpers";

/**
 * Full platform E2E test with real Stripe sandbox payment.
 *
 * Flow:
 *   1. Create guest stay via API (bypasses date-picker month-boundary issues)
 *   2. Admin approves the stay → NEEDS_PAYMENT
 *   3. Checkout session created in redirect mode → Stripe hosted page
 *   4. Test card 4242… filled in on Stripe checkout
 *   5. Payment completes → redirect to /payment-success
 *   6. Confirm-payment endpoint finalises the stay → PAID
 */

test.setTimeout(120_000);

/* ── Helper: format date as YYYY-MM-DD ── */
function toIso(d: Date) {
  return d.toISOString().slice(0, 10);
}

test.describe("Stripe Payment E2E", () => {
  test("guest request → admin approve → Stripe checkout → payment success", async ({
    page,
  }) => {
    const testId = Date.now().toString().slice(-6);
    const uniquePlate = `STR${testId}`;
    const today = new Date();
    const startDate = toIso(today);
    const endDate = toIso(new Date(today.getTime() + 4 * 86_400_000)); // 4 nights

    // ═══════════════════════════════════════════════════════════════
    // STEP 1 — Create guest stay via API (public endpoint)
    // ═══════════════════════════════════════════════════════════════
    let stayId: number;

    await test.step("Create guest stay via API", async () => {
      const res = await page.request.post("/api/guest-stays", {
        data: {
          residentEmail: ACCOUNTS.resident.email,
          guest: { fullName: "Stripe Test Guest", email: `stripe-${testId}@test.com` },
          vehicle: { plate: uniquePlate, desc: "2024 Red Tesla Model 3" },
          stay: { startDate, endDate },
        },
      });
      expect(res.ok()).toBeTruthy();
      const data = await res.json();
      stayId = data.id;
      expect(stayId).toBeTruthy();
      console.log(`  ✓ Stay #${stayId} created (${startDate} → ${endDate}, 4 nights)`);
    });

    // ═══════════════════════════════════════════════════════════════
    // STEP 2 — Admin approves the stay
    // ═══════════════════════════════════════════════════════════════
    await test.step("Admin approves the stay", async () => {
      await loginAsAdmin(page);

      const approveRes = await page.request.post(
        `/api/guest-stays/${stayId}/approve`
      );
      expect(approveRes.ok()).toBeTruthy();
      const data = await approveRes.json();
      expect(data.status).toBe("NEEDS_PAYMENT");

      const dollars = ((data.billing?.amountCents ?? 0) / 100).toFixed(2);
      console.log(`  ✓ Stay #${stayId} approved — $${dollars} due`);
    });

    // ═══════════════════════════════════════════════════════════════
    // STEP 3 — Create Stripe checkout session (redirect mode)
    // ═══════════════════════════════════════════════════════════════
    let stripeUrl: string;

    await test.step("Create Stripe redirect checkout session", async () => {
      const res = await page.request.post("/api/checkout-session", {
        data: { stayId, embedded: false },
      });
      expect(res.ok()).toBeTruthy();
      const data = await res.json();
      expect(data.url).toBeTruthy();
      expect(data.requiresPayment).toBe(true);
      stripeUrl = data.url;

      console.log(`  ✓ Stripe URL obtained — $${(data.amountCents / 100).toFixed(2)}`);
    });

    // ═══════════════════════════════════════════════════════════════
    // STEP 4 — Fill in Stripe test card & pay
    // ═══════════════════════════════════════════════════════════════
    await test.step("Complete Stripe checkout with test card", async () => {
      await page.goto(stripeUrl);
      await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(3000);

      // Select USD currency if PHP is pre-selected
      const usdBtn = page.getByRole("button", { name: /\$10|\$\d+\.\d+/ });
      if (await usdBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await usdBtn.click();
        await page.waitForTimeout(1000);
      }

      // Card number — directly on page (not in iframe)
      await page.getByRole("textbox", { name: "Card number" }).fill("4242 4242 4242 4242");
      await page.waitForTimeout(300);

      // Expiry
      await page.getByRole("textbox", { name: "Expiration" }).fill("12 / 30");
      await page.waitForTimeout(300);

      // CVC
      await page.getByRole("textbox", { name: "CVC" }).fill("123");
      await page.waitForTimeout(300);

      // Cardholder name
      await page.getByRole("textbox", { name: "Cardholder name" }).fill("Stripe Test Guest");
      await page.waitForTimeout(300);

      // Country — select United States
      await page.getByRole("combobox", { name: "Country or region" }).selectOption("United States");
      await page.waitForTimeout(500);

      // ZIP code (appears after selecting US)
      const zipField = page.getByRole("textbox", { name: /zip/i });
      if (await zipField.isVisible({ timeout: 2000 }).catch(() => false)) {
        await zipField.fill("10001");
      }

      await page.waitForTimeout(500);

      // Submit payment
      await page.getByRole("button", { name: "Pay" }).click();

      console.log("  ✓ Payment submitted — waiting for redirect…");
    });

    // ═══════════════════════════════════════════════════════════════
    // STEP 5 — Verify payment success
    // ═══════════════════════════════════════════════════════════════
    await test.step("Verify payment success page", async () => {
      await page.waitForURL(/payment-success/, { timeout: 60_000 });
      await expect(page.getByText(/payment successful/i)).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("Paid", { exact: true })).toBeVisible({ timeout: 5000 });

      console.log("  ✓ Payment confirmed on success page!");
    });

    // ═══════════════════════════════════════════════════════════════
    // STEP 6 — Verify stay status via API
    // ═══════════════════════════════════════════════════════════════
    await test.step("Verify stay status is PAID in database", async () => {
      // Re-login via API (not UI) to avoid navigation timeout after Stripe redirect
      const loginRes = await page.request.post("/api/auth/login", {
        data: {
          email: ACCOUNTS.admin.email,
          password: ACCOUNTS.admin.password,
        },
      });
      expect(loginRes.ok()).toBeTruthy();

      const res = await page.request.get("/api/guest-stays");
      expect(res.ok()).toBeTruthy();
      const data = await res.json();

      const normalizedPlate = uniquePlate.toUpperCase().replace(/-/g, "");
      const paidStay = data.stays?.find(
        (s: { vehicle_plate: string; id: number }) =>
          s.vehicle_plate === normalizedPlate && s.id === stayId
      );

      expect(paidStay).toBeTruthy();
      expect(paidStay.status).toBe("PAID");

      console.log(`  ✓ Stay #${stayId} status confirmed: PAID`);
    });
  });
});
