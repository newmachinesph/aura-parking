import { test, expect, type Page } from "@playwright/test";
import { ACCOUNTS } from "./helpers";

/**
 * Comprehensive Pass & Billing E2E Tests
 *
 * Creates a FRESH test resident to guarantee known pass state:
 *   - 1 monthly free night (unused)
 *   - 0 bonus passes
 *   - No guest vehicle free passes consumed
 *
 * Tests all pass types and their interactions:
 *   S0 — Setup: create fresh test resident (guaranteed 1 monthly, 0 bonus)
 *   S1 — Guest vehicle free pass: 1-night stay, new plate → APPROVED ($0)
 *   S2 — Monthly resident pass: 2-night stay → guest free (1) + monthly (1) → APPROVED ($0)
 *   S3 — Paid pass (Stripe): 2-night stay, all passes depleted → $10.00 → PAID
 *   S4 — Combined passes: Sarah (adaptive to actual DB state)
 *   S5 — Final pass balance verification
 *
 * Pass application order: Guest vehicle free → Bonus → Monthly (oldest first)
 * Rate: $5.00 / night (500¢)
 */

test.setTimeout(180_000);

/* ── Helpers ── */

function toIso(d: Date) {
  return d.toISOString().slice(0, 10);
}

const RUN_ID = Date.now().toString().slice(-6);
const today = new Date();

function stayDates(nights: number) {
  return {
    startDate: toIso(today),
    endDate: toIso(new Date(today.getTime() + nights * 86_400_000)),
  };
}

async function apiLoginAdmin(page: Page) {
  const res = await page.request.post("/api/auth/login", {
    data: { email: ACCOUNTS.admin.email, password: ACCOUNTS.admin.password },
  });
  expect(res.ok()).toBeTruthy();
}

async function createStay(
  page: Page,
  opts: {
    residentEmail: string;
    guestName: string;
    guestEmail: string;
    plate: string;
    nights: number;
  },
) {
  const { startDate, endDate } = stayDates(opts.nights);
  const res = await page.request.post("/api/guest-stays", {
    data: {
      residentEmail: opts.residentEmail,
      guest: { fullName: opts.guestName, email: opts.guestEmail },
      vehicle: { plate: opts.plate, desc: "E2E Test Vehicle" },
      stay: { startDate, endDate },
    },
  });
  expect(res.ok()).toBeTruthy();
  const data = await res.json();
  expect(data.id).toBeTruthy();
  return { id: data.id as number, startDate, endDate };
}

async function approveStay(page: Page, stayId: number) {
  const res = await page.request.post(`/api/guest-stays/${stayId}/approve`);
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function getPassBalance(page: Page, residentId: number) {
  const res = await page.request.get(
    `/api/residents/${residentId}/pass-balance`,
  );
  expect(res.ok()).toBeTruthy();
  return res.json();
}

/* ── Fresh test resident credentials ── */
const TEST_EMAIL = `e2e-pass-${RUN_ID}@test.com`;
const TEST_PASSWORD = process.env.SEED_PASSWORD!;
const TEST_UNIT = `T${RUN_ID}`;
const TEST_NAME = `E2E Pass ${RUN_ID}`;

/* ── Shared state across serial tests ── */
let testResidentId: number;
let sarahResidentId: number;

// Plate from S1 — reused in S3 to test "already used" guest free pass
const s1Plate = `GP1${RUN_ID}`;

/* ── Resident emails ── */
const SARAH_EMAIL = ACCOUNTS.residentWithBonus.email; // sarah.johnson@email.com, Unit 2001

test.describe.serial("Pass & Billing Scenarios", () => {
  // ═══════════════════════════════════════════════════════════════
  // S0 — SETUP: Create a fresh test resident
  //
  // Admin creates a brand new resident via the API. This guarantees:
  //   - 1 monthly free night bucket (current month, unused)
  //   - 0 bonus passes
  //   - No guest vehicle free passes consumed
  // This eliminates dependency on prior DB state.
  // ═══════════════════════════════════════════════════════════════
  test("S0: Setup — create fresh test resident with known pass state", async ({
    page,
  }) => {
    await apiLoginAdmin(page);

    const res = await page.request.post("/api/admin/users", {
      data: {
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        role: "resident",
        fullName: TEST_NAME,
        unitNumber: TEST_UNIT,
        status: "ACTIVE",
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.status).toBe("ok");

    console.log(
      `  ✓ S0: Created test resident "${TEST_NAME}" (${TEST_EMAIL}, Unit ${TEST_UNIT})`,
    );
    console.log(
      `  ✓ S0: Guaranteed state → 1 monthly free night, 0 bonus passes`,
    );
  });

  // ═══════════════════════════════════════════════════════════════
  // S1 — GUEST VEHICLE FREE PASS
  //
  // New plate gets a one-time free night. For a 1-night stay, the
  // guest free pass short-circuits: no bonus or monthly consumed.
  // Result: APPROVED ($0), monthly pass untouched (still 1)
  // ═══════════════════════════════════════════════════════════════
  test("S1: Guest vehicle free pass covers 1-night stay → APPROVED ($0)", async ({
    page,
  }) => {
    await apiLoginAdmin(page);

    const stay = await createStay(page, {
      residentEmail: TEST_EMAIL,
      guestName: `Guest S1 ${RUN_ID}`,
      guestEmail: `s1-${RUN_ID}@test.com`,
      plate: s1Plate,
      nights: 1,
    });

    const result = await approveStay(page, stay.id);
    testResidentId = result.billing.residentId;

    // Verify billing: guest vehicle free pass applied, nothing else consumed
    expect(result.status).toBe("APPROVED");
    expect(result.billing.totalNights).toBe(1);
    expect(result.billing.guestFreePassApplied).toBe(1);
    expect(result.billing.bonusNightsApplied).toBe(0);
    expect(result.billing.freeNightsApplied).toBe(0); // Monthly NOT consumed (short-circuit)
    expect(result.billing.billableNights).toBe(0);
    expect(result.billing.amountCents).toBe(0);

    // Verify monthly pass was NOT consumed (1-night short-circuit rule)
    const balance = await getPassBalance(page, testResidentId);
    expect(balance.monthlyFreeRemaining).toBe(1); // Still 1!
    expect(balance.bonusPasses).toBe(0);

    console.log(
      `  ✓ S1: 1-night stay, new plate "${s1Plate}" → guest free pass applied, $0 — APPROVED`,
    );
    console.log(
      `  ✓ S1: Monthly pass untouched (short-circuit): ${balance.monthlyFreeRemaining} remaining`,
    );
  });

  // ═══════════════════════════════════════════════════════════════
  // S2 — MONTHLY RESIDENT PASS
  //
  // 2-night stay with a new plate:
  //   - Guest free covers night 1
  //   - Monthly free pass covers night 2
  //   - 0 billable nights → APPROVED ($0)
  //
  // Verifies actual monthly pass deduction: 1 → 0
  // ═══════════════════════════════════════════════════════════════
  test("S2: Monthly pass deduction — 2-night stay → guest free (1) + monthly (1) → APPROVED ($0)", async ({
    page,
  }) => {
    await apiLoginAdmin(page);

    // Verify we have exactly 1 monthly pass available
    const before = await getPassBalance(page, testResidentId);
    expect(before.monthlyFreeRemaining).toBe(1);
    expect(before.bonusPasses).toBe(0);

    const s2Plate = `GP2${RUN_ID}`;
    const stay = await createStay(page, {
      residentEmail: TEST_EMAIL,
      guestName: `Guest S2 ${RUN_ID}`,
      guestEmail: `s2-${RUN_ID}@test.com`,
      plate: s2Plate,
      nights: 2,
    });

    const result = await approveStay(page, stay.id);

    // Verify billing breakdown
    expect(result.billing.totalNights).toBe(2);
    expect(result.billing.guestFreePassApplied).toBe(1); // New plate
    expect(result.billing.bonusNightsApplied).toBe(0); // No bonus available
    expect(result.billing.freeNightsApplied).toBe(1); // Monthly covers 1 night
    expect(result.billing.billableNights).toBe(0); // Nothing left to bill
    expect(result.billing.amountCents).toBe(0);
    expect(result.status).toBe("APPROVED");

    // Verify monthly pass was consumed: 1 → 0
    const after = await getPassBalance(page, testResidentId);
    expect(after.monthlyFreeRemaining).toBe(0);

    console.log(
      `  ✓ S2: 2-night stay → guest free (1) + monthly (1) = $0 — APPROVED`,
    );
    console.log(
      `  ✓ S2: Monthly pass deducted: ${before.monthlyFreeRemaining} → ${after.monthlyFreeRemaining}`,
    );
  });

  // ═══════════════════════════════════════════════════════════════
  // S3 — PAID PASS (STRIPE PAYMENT)
  //
  // All passes are now exhausted:
  //   - Guest vehicle free: consumed for s1Plate
  //   - Monthly: consumed in S2
  //   - Bonus: none available
  //
  // 2-night stay with reused plate → 2 billable = $10.00
  // → NEEDS_PAYMENT → Stripe checkout → PAID
  // ═══════════════════════════════════════════════════════════════
  test("S3: All passes depleted → full Stripe payment ($10.00) → PAID", async ({
    page,
  }) => {
    await apiLoginAdmin(page);

    // Confirm all passes are exhausted
    const balance = await getPassBalance(page, testResidentId);
    expect(balance.monthlyFreeRemaining).toBe(0);
    expect(balance.bonusPasses).toBe(0);

    const stay = await createStay(page, {
      residentEmail: TEST_EMAIL,
      guestName: `Guest S3 ${RUN_ID}`,
      guestEmail: `s3-${RUN_ID}@test.com`,
      plate: s1Plate, // Reuse plate from S1 — guest free already consumed
      nights: 2,
    });

    const result = await approveStay(page, stay.id);

    // All passes exhausted — everything is billable
    expect(result.billing.guestFreePassApplied).toBe(0); // Plate already used
    expect(result.billing.bonusNightsApplied).toBe(0);
    expect(result.billing.freeNightsApplied).toBe(0);
    expect(result.billing.billableNights).toBe(2);
    expect(result.billing.amountCents).toBe(1000); // 2 × $5.00
    expect(result.status).toBe("NEEDS_PAYMENT");

    console.log(
      `  ✓ S3: 2-night stay, reused plate → 2 billable = $10.00 — NEEDS_PAYMENT`,
    );

    // Create Stripe checkout session (redirect mode)
    const checkoutRes = await page.request.post("/api/checkout-session", {
      data: { stayId: stay.id, embedded: false },
    });
    expect(checkoutRes.ok()).toBeTruthy();
    const checkout = await checkoutRes.json();
    expect(checkout.url).toBeTruthy();
    expect(checkout.requiresPayment).toBe(true);

    console.log(
      `  ✓ S3: Stripe checkout URL obtained — $${(checkout.amountCents / 100).toFixed(2)}`,
    );

    // Navigate to Stripe hosted checkout
    await page.goto(checkout.url);
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(3000);

    // Fill test card details
    await page
      .getByRole("textbox", { name: "Card number" })
      .fill("4242 4242 4242 4242");
    await page.waitForTimeout(300);
    await page.getByRole("textbox", { name: "Expiration" }).fill("12 / 30");
    await page.waitForTimeout(300);
    await page.getByRole("textbox", { name: "CVC" }).fill("123");
    await page.waitForTimeout(300);
    await page
      .getByRole("textbox", { name: "Cardholder name" })
      .fill("Guest S3");
    await page.waitForTimeout(300);
    await page
      .getByRole("combobox", { name: "Country or region" })
      .selectOption("United States");
    await page.waitForTimeout(500);

    const zipField = page.getByRole("textbox", { name: /zip/i });
    if (await zipField.isVisible({ timeout: 2000 }).catch(() => false)) {
      await zipField.fill("10001");
    }
    await page.waitForTimeout(500);

    await page.getByRole("button", { name: "Pay" }).click();
    console.log(`  ✓ S3: Payment submitted — waiting for redirect…`);

    // Verify payment success page
    await page.waitForURL(/payment-success/, { timeout: 60_000 });
    await expect(page.getByText(/payment successful/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Paid", { exact: true })).toBeVisible({
      timeout: 5000,
    });

    console.log(`  ✓ S3: Payment confirmed on success page!`);

    // Verify stay status is PAID in database
    await apiLoginAdmin(page);
    const staysRes = await page.request.get("/api/guest-stays");
    expect(staysRes.ok()).toBeTruthy();
    const staysData = await staysRes.json();
    const paidStay = staysData.stays?.find(
      (s: { id: number }) => s.id === stay.id,
    );
    expect(paidStay).toBeTruthy();
    expect(paidStay.status).toBe("PAID");

    console.log(`  ✓ S3: Stay #${stay.id} confirmed PAID in database`);
  });

  // ═══════════════════════════════════════════════════════════════
  // S4 — COMBINED PASSES (Sarah — adaptive to actual DB state)
  //
  // Sarah (Unit 2001) may have bonus passes depending on DB seed.
  // Tests the full pass application hierarchy:
  //   Guest vehicle free → Bonus → Monthly → Billable
  //
  // Assertions adapt to whatever passes Sarah actually has.
  // ═══════════════════════════════════════════════════════════════
  test("S4: Combined passes — Sarah (bonus + guest free + monthly)", async ({
    page,
  }) => {
    await apiLoginAdmin(page);

    // Discover Sarah's residentId via a 1-night probe stay
    const probeStay = await createStay(page, {
      residentEmail: SARAH_EMAIL,
      guestName: `Probe S4 ${RUN_ID}`,
      guestEmail: `probe-s4-${RUN_ID}@test.com`,
      plate: `PRB4${RUN_ID}`,
      nights: 1,
    });
    const probeResult = await approveStay(page, probeStay.id);
    sarahResidentId = probeResult.billing.residentId;

    // Probe: 1-night + new plate = guest free pass short-circuit ($0)
    expect(probeResult.status).toBe("APPROVED");
    expect(probeResult.billing.guestFreePassApplied).toBe(1);

    // Read Sarah's actual pass balance
    const before = await getPassBalance(page, sarahResidentId);
    console.log(
      `  → Sarah before S4: ${before.bonusPasses} bonus, ${before.monthlyFreeRemaining} monthly`,
    );

    // Create a 4-night stay with a new plate to test all pass types
    const s4Plate = `GP4${RUN_ID}`;
    const stay = await createStay(page, {
      residentEmail: SARAH_EMAIL,
      guestName: `Guest S4 ${RUN_ID}`,
      guestEmail: `s4-${RUN_ID}@test.com`,
      plate: s4Plate,
      nights: 4,
    });

    const result = await approveStay(page, stay.id);

    // Verify total nights and guest free pass
    expect(result.billing.totalNights).toBe(4);
    expect(result.billing.guestFreePassApplied).toBe(1); // New plate

    const bonusApplied = result.billing.bonusNightsApplied as number;
    const monthlyApplied = result.billing.freeNightsApplied as number;
    const billable = result.billing.billableNights as number;

    // Verify internal consistency: all 4 nights accounted for
    expect(1 + bonusApplied + monthlyApplied + billable).toBe(4);
    expect(result.billing.amountCents).toBe(billable * 500);

    // Verify pass application follows priority order:
    // 1. Bonus applied first (up to 3 remaining nights, capped by available)
    const maxBonus = Math.min(3, before.bonusPasses);
    expect(bonusApplied).toBe(maxBonus);

    // 2. Monthly applied next (from remaining nights after bonus)
    const nightsAfterBonus = 3 - maxBonus;
    const maxMonthly = Math.min(nightsAfterBonus, before.monthlyFreeRemaining);
    expect(monthlyApplied).toBe(maxMonthly);

    // 3. Billable = whatever's left
    expect(billable).toBe(3 - maxBonus - maxMonthly);

    // Verify status matches billing
    if (billable > 0) {
      expect(result.status).toBe("NEEDS_PAYMENT");
    } else {
      expect(result.status).toBe("APPROVED");
    }

    // Verify pass balance decreased correctly
    const after = await getPassBalance(page, sarahResidentId);
    expect(after.bonusPasses).toBe(before.bonusPasses - bonusApplied);
    expect(after.monthlyFreeRemaining).toBe(
      before.monthlyFreeRemaining - monthlyApplied,
    );

    console.log(
      `  ✓ S4: 4-night → guest free (1) + bonus (${bonusApplied}) + monthly (${monthlyApplied}) + billable (${billable}) = $${(result.billing.amountCents / 100).toFixed(2)} — ${result.status}`,
    );
    console.log(
      `  ✓ S4: Sarah bonus: ${before.bonusPasses} → ${after.bonusPasses}, monthly: ${before.monthlyFreeRemaining} → ${after.monthlyFreeRemaining}`,
    );
  });

  // ═══════════════════════════════════════════════════════════════
  // S5 — FINAL PASS BALANCE VERIFICATION
  //
  // Confirm all pass deductions persisted correctly:
  //   Test resident: 0 monthly (consumed in S2), 0 bonus
  //   Sarah: adjusted by whatever was consumed in S4
  // ═══════════════════════════════════════════════════════════════
  test("S5: Final pass balance verification", async ({ page }) => {
    await apiLoginAdmin(page);

    // Test resident: all passes exhausted after S1 + S2
    const testBal = await getPassBalance(page, testResidentId);
    expect(testBal.monthlyFreeRemaining).toBe(0);
    expect(testBal.bonusPasses).toBe(0);

    // Sarah: verify non-negative (exact values depend on initial state)
    const sarahBal = await getPassBalance(page, sarahResidentId);
    expect(sarahBal.monthlyFreeRemaining).toBeGreaterThanOrEqual(0);
    expect(sarahBal.bonusPasses).toBeGreaterThanOrEqual(0);

    console.log(
      `  ✓ S5: Test resident — monthly: ${testBal.monthlyFreeRemaining}, bonus: ${testBal.bonusPasses}`,
    );
    console.log(
      `  ✓ S5: Sarah — monthly: ${sarahBal.monthlyFreeRemaining}, bonus: ${sarahBal.bonusPasses}`,
    );

    // Summary
    console.log(`\n  ══════════════════════════════════════`);
    console.log(`  Pass & Billing Scenarios — Summary`);
    console.log(`  ──────────────────────────────────────`);
    console.log(`  S0: Fresh test resident setup     ✓`);
    console.log(`  S1: Guest vehicle free pass       ✓`);
    console.log(`  S2: Monthly resident pass (1→0)   ✓`);
    console.log(`  S3: Full Stripe payment (PAID)    ✓`);
    console.log(`  S4: Combined pass scenario        ✓`);
    console.log(`  S5: Balance verification          ✓`);
    console.log(`  ══════════════════════════════════════\n`);
  });
});
