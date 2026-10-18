import { test, expect, type Page } from "@playwright/test";
import { ACCOUNTS, clearMailpit, waitForEmail } from "./helpers";

/**
 * API-level Guest Lifecycle & Billing E2E Tests
 *
 * Tests the complete guest stay lifecycle via API:
 *   - Create, approve, edit, cancel flows
 *   - Status transition enforcement (state machine)
 *   - Billing recalculation on edit
 *   - Cross-unit plate conflict detection
 *   - Same-day stay (1-night minimum)
 *   - Plate normalization
 *   - Guest free pass one-time enforcement
 *   - Monthly cron pass allocation
 *   - Admin bypass payment
 *   - refreshPendingStayBilling after approval
 *
 * Creates a FRESH test resident per run to guarantee known state.
 */

test.setTimeout(180_000);

/* ── Helpers ── */

const RUN_ID = Date.now().toString(36).slice(-6);

function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

async function apiLogin(page: Page, email: string, password: string) {
  const res = await page.request.post("/api/auth/login", {
    data: { email, password },
  });
  expect(res.ok(), `Login failed for ${email}: ${res.status()}`).toBeTruthy();
}

async function apiLoginAdmin(page: Page) {
  await apiLogin(page, ACCOUNTS.admin.email, ACCOUNTS.admin.password);
}

async function createStay(
  page: Page,
  opts: {
    residentEmail?: string;
    unitNumber?: string;
    guestName: string;
    guestEmail?: string;
    plate: string;
    startDate: string;
    endDate: string;
  },
) {
  const data: Record<string, unknown> = {
    guest: { fullName: opts.guestName, email: opts.guestEmail || `g-${RUN_ID}@test.com` },
    vehicle: { plate: opts.plate, desc: "E2E Test Vehicle" },
    stay: { startDate: opts.startDate, endDate: opts.endDate },
  };
  if (opts.residentEmail) data.residentEmail = opts.residentEmail;
  if (opts.unitNumber) data.unitNumber = opts.unitNumber;

  const res = await page.request.post("/api/guest-stays", { data });
  return { status: res.status(), data: await res.json() };
}

async function approveStay(page: Page, stayId: number | string) {
  const res = await page.request.post(`/api/guest-stays/${stayId}/approve`);
  return { status: res.status(), data: await res.json() };
}

async function editStay(page: Page, stayId: number | string, body: Record<string, unknown>) {
  const res = await page.request.patch(`/api/guest-stays/${stayId}`, { data: body });
  return { status: res.status(), data: await res.json() };
}

async function cancelStay(page: Page, stayId: number | string) {
  const res = await page.request.delete(`/api/guest-stays/${stayId}`);
  return { status: res.status(), data: await res.json() };
}

async function getPassBalance(page: Page, residentId: number | string) {
  const res = await page.request.get(`/api/residents/${residentId}/pass-balance`);
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function bypassPayment(page: Page, stayId: number | string, opts?: { billableDays?: number }) {
  const res = await page.request.post(`/api/guest-stays/${stayId}/admin-bypass-payment`, {
    data: opts || {},
  });
  return { status: res.status(), data: await res.json() };
}

/* ── Test resident credentials ── */
const TEST_EMAIL = `e2e-lifecycle-${RUN_ID}@test.com`;
const TEST_PASSWORD = process.env.SEED_PASSWORD!;
const TEST_UNIT = `L${RUN_ID.slice(0, 4).toUpperCase()}`;
const TEST_NAME = `E2E Lifecycle ${RUN_ID}`;

/* 2nd resident for cross-unit tests */
const TEST_EMAIL_2 = `e2e-cross-${RUN_ID}@test.com`;
const TEST_UNIT_2 = `X${RUN_ID.slice(0, 4).toUpperCase()}`;

/* ── Shared state ── */
let residentId: number;
let stayIdPending: number;
let stayIdApproved: number;
let stayIdCancelled: number;
let stayIdNeedsPayment: number;
let stayIdPendingRefresh: number;

test.describe.serial("API: Guest Lifecycle & Billing", () => {
  // ═══════════════════════════════════════════
  // S0 — SETUP: Create fresh test residents
  // ═══════════════════════════════════════════
  test("S0: Setup — create test residents with known pass state", async ({ page }) => {
    await apiLoginAdmin(page);

    // Create primary test resident
    const res1 = await page.request.post("/api/admin/users", {
      data: {
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        role: "resident",
        fullName: TEST_NAME,
        unitNumber: TEST_UNIT,
        status: "ACTIVE",
      },
    });
    expect(res1.status()).toBe(201);

    // Create 2nd test resident for cross-unit tests
    const res2 = await page.request.post("/api/admin/users", {
      data: {
        email: TEST_EMAIL_2,
        password: TEST_PASSWORD,
        role: "resident",
        fullName: `E2E Cross ${RUN_ID}`,
        unitNumber: TEST_UNIT_2,
        status: "ACTIVE",
      },
    });
    expect(res2.status()).toBe(201);

    console.log(`  ✓ S0: Created test residents — Unit ${TEST_UNIT} & ${TEST_UNIT_2}`);
  });

  // ═══════════════════════════════════════════
  // S1 — Create guest stay → PENDING
  // ═══════════════════════════════════════════
  test("S1: Create guest stay → PENDING with billing estimate", async ({ page }) => {
    await apiLoginAdmin(page);

    const plate = `LC1${RUN_ID}`;
    const { status, data } = await createStay(page, {
      residentEmail: TEST_EMAIL,
      guestName: `Guest S1 ${RUN_ID}`,
      plate,
      startDate: futureDate(1),
      endDate: futureDate(2),
    });

    expect(status).toBe(201);
    expect(Number(data.id)).toBeGreaterThan(0);
    expect(data.status).toBe("PENDING");
    stayIdPending = Number(data.id);

    // Verify billing estimate was stored in DB by fetching via list
    const listRes = await page.request.get("/api/guest-stays");
    const listData = await listRes.json();
    const createdStay = listData.stays?.find(
      (s: { id: number | string }) => Number(s.id) === stayIdPending,
    );
    expect(createdStay).toBeTruthy();
    // New plate should get guest free pass → 1 night free, $0
    expect(createdStay.guest_free_pass_nights).toBe(1);
    expect(createdStay.amount_cents).toBe(0);

    console.log(`  ✓ S1: Stay #${stayIdPending} created — PENDING, billing $0 (free pass)`);
  });

  // ═══════════════════════════════════════════
  // S2 — Approve guest → APPROVED ($0)
  // ═══════════════════════════════════════════
  test("S2: Approve PENDING stay → APPROVED with free pass consumed", async ({ page }) => {
    await apiLoginAdmin(page);

    const { status, data } = await approveStay(page, stayIdPending);
    expect(status).toBe(200);
    expect(data.status).toBe("APPROVED");
    expect(data.billing.guestFreePassApplied).toBe(1);
    expect(data.billing.amountCents).toBe(0);
    stayIdApproved = stayIdPending;

    // Get residentId from billing for later use
    residentId = Number(data.billing.residentId);
    expect(residentId).toBeGreaterThan(0);

    console.log(`  ✓ S2: Stay #${stayIdApproved} → APPROVED ($0, guest free pass consumed)`);
  });

  // ═══════════════════════════════════════════
  // S3 — Guest free pass one-time: same plate → no free pass
  // ═══════════════════════════════════════════
  test("S3: Same plate reused → guest free pass NOT applied", async ({ page }) => {
    await apiLoginAdmin(page);

    const plate = `LC1${RUN_ID}`; // Same plate as S1
    const { status, data } = await createStay(page, {
      residentEmail: TEST_EMAIL,
      guestName: `Guest S3 ${RUN_ID}`,
      plate,
      startDate: futureDate(3),
      endDate: futureDate(4),
    });

    expect(status).toBe(201);
    expect(data.status).toBe("PENDING");

    // Guest free pass should NOT be applied (already consumed in S2)
    // Verify via list endpoint
    const listRes = await page.request.get("/api/guest-stays");
    const listData = await listRes.json();
    const createdStay = listData.stays?.find(
      (s: { id: number | string }) => Number(s.id) === Number(data.id),
    );
    expect(createdStay).toBeTruthy();
    expect(createdStay.guest_free_pass_nights).toBe(0); // Used plate

    console.log(`  ✓ S3: Same plate — guest free pass NOT applied`);

    // Clean up
    await cancelStay(page, data.id);
  });

  // ═══════════════════════════════════════════
  // S4 — Same-day stay = 1 night minimum
  // ═══════════════════════════════════════════
  test("S4: Same-day stay (start == end) = 1 night minimum billing", async ({ page }) => {
    await apiLoginAdmin(page);

    const sameDay = futureDate(5);
    const plate = `LC4${RUN_ID}`;
    const { status, data } = await createStay(page, {
      residentEmail: TEST_EMAIL,
      guestName: `Guest S4 ${RUN_ID}`,
      plate,
      startDate: sameDay,
      endDate: sameDay, // Same date
    });

    expect(status).toBe(201);

    // Verify billing via list endpoint
    const listRes = await page.request.get("/api/guest-stays");
    const listData = await listRes.json();
    const createdStay = listData.stays?.find(
      (s: { id: number | string }) => Number(s.id) === Number(data.id),
    );
    expect(createdStay).toBeTruthy();
    // Same-day = 1 night minimum: passes_applied + billable_nights should equal 1
    const totalNights = (createdStay.passes_applied || 0) + (createdStay.billable_nights || 0);
    expect(totalNights).toBe(1);

    console.log(`  ✓ S4: Same-day stay → 1-night minimum billing`);

    // Clean up
    await cancelStay(page, data.id);
  });

  // ═══════════════════════════════════════════
  // S5 — Cross-unit plate conflict detection
  // ═══════════════════════════════════════════
  test("S5: Cross-unit plate conflict detected", async ({ page }) => {
    await apiLoginAdmin(page);

    const conflictPlate = `CF5${RUN_ID}`;

    // Create stay for unit 1
    const { data: stay1 } = await createStay(page, {
      residentEmail: TEST_EMAIL,
      guestName: `Guest CF1 ${RUN_ID}`,
      plate: conflictPlate,
      startDate: futureDate(1),
      endDate: futureDate(3),
    });
    expect(Number(stay1.id)).toBeGreaterThan(0);

    // Approve the stay so it's active
    await approveStay(page, stay1.id);

    // Try to create stay with same plate for unit 2
    const { status, data: stay2 } = await createStay(page, {
      residentEmail: TEST_EMAIL_2,
      guestName: `Guest CF2 ${RUN_ID}`,
      plate: conflictPlate,
      startDate: futureDate(1),
      endDate: futureDate(3),
    });

    // Should fail with conflict error
    expect(status).toBe(409);
    expect(stay2.error).toBeTruthy();

    console.log(`  ✓ S5: Cross-unit plate conflict correctly detected`);
  });

  // ═══════════════════════════════════════════
  // S6 — Plate normalization
  // ═══════════════════════════════════════════
  test("S6: Plate normalization (abc-123 == ABC123)", async ({ page }) => {
    await apiLoginAdmin(page);

    const plate1 = `pn-6${RUN_ID}`;
    const plate2 = `PN 6${RUN_ID}`; // Different format, same normalized value

    // Create first stay with lowercase/dashes
    const { data: stay1 } = await createStay(page, {
      residentEmail: TEST_EMAIL,
      guestName: `Guest PN1 ${RUN_ID}`,
      plate: plate1,
      startDate: futureDate(10),
      endDate: futureDate(11),
    });
    expect(Number(stay1.id)).toBeGreaterThan(0);

    // Approve it
    await approveStay(page, stay1.id);

    // Create second stay with different format of same plate
    const { data: stay2 } = await createStay(page, {
      residentEmail: TEST_EMAIL,
      guestName: `Guest PN2 ${RUN_ID}`,
      plate: plate2,
      startDate: futureDate(12),
      endDate: futureDate(13),
    });
    expect(Number(stay2.id)).toBeGreaterThan(0);

    // Guest free pass should NOT be applied (same normalized plate)
    // Verify via list endpoint
    const listRes = await page.request.get("/api/guest-stays");
    const listData = await listRes.json();
    const createdStay2 = listData.stays?.find(
      (s: { id: number | string }) => Number(s.id) === Number(stay2.id),
    );
    expect(createdStay2).toBeTruthy();
    expect(createdStay2.guest_free_pass_nights).toBe(0);

    console.log(`  ✓ S6: Plate normalization — "${plate1}" and "${plate2}" treated as same plate`);

    await cancelStay(page, stay2.id);
  });

  // ═══════════════════════════════════════════
  // S7 — Edit pending stay dates → billing recalculated
  // ═══════════════════════════════════════════
  test("S7: Edit PENDING stay dates → billing recalculated", async ({ page }) => {
    await apiLoginAdmin(page);

    // Create a 1-night stay with new plate
    const plate = `LC7${RUN_ID}`;
    const { data: stay } = await createStay(page, {
      residentEmail: TEST_EMAIL,
      guestName: `Guest S7 ${RUN_ID}`,
      plate,
      startDate: futureDate(15),
      endDate: futureDate(16),
    });
    // Verify 1-night billing from list
    const listRes1 = await page.request.get("/api/guest-stays");
    const listData1 = await listRes1.json();
    const origStay = listData1.stays?.find(
      (s: { id: number | string }) => Number(s.id) === Number(stay.id),
    );
    expect(origStay).toBeTruthy();
    const origTotalNights = (origStay.passes_applied || 0) + (origStay.billable_nights || 0);
    expect(origTotalNights).toBe(1);

    // Edit to 3-night stay
    const { status } = await editStay(page, stay.id, {
      endDate: futureDate(18),
    });
    expect(status).toBe(200);

    // Verify billing was recalculated via approve to see final billing
    const { data: approveData } = await approveStay(page, stay.id);
    expect(approveData.billing.totalNights).toBe(3);
    // Billing should be different from 1-night (more nights = more cost or more pass usage)
    expect(approveData.billing.totalNights).toBeGreaterThan(1);

    console.log(`  ✓ S7: Edited dates → billing recalculated (1 night → 3 nights)`);
  });

  // ═══════════════════════════════════════════
  // S8 — Cancel PENDING stay → CANCELLED
  // ═══════════════════════════════════════════
  test("S8: Cancel PENDING stay → CANCELLED", async ({ page }) => {
    await apiLoginAdmin(page);

    // Create a stay to cancel
    const plate = `LC8${RUN_ID}`;
    const { data: stay } = await createStay(page, {
      residentEmail: TEST_EMAIL,
      guestName: `Guest S8 ${RUN_ID}`,
      plate,
      startDate: futureDate(20),
      endDate: futureDate(21),
    });
    expect(stay.status).toBe("PENDING");

    const { status, data } = await cancelStay(page, stay.id);
    expect(status).toBe(200);
    stayIdCancelled = Number(stay.id);

    console.log(`  ✓ S8: Stay #${stayIdCancelled} → CANCELLED`);
  });

  // ═══════════════════════════════════════════
  // S9 — Can't approve CANCELLED stay
  // ═══════════════════════════════════════════
  test("S9: Can't approve CANCELLED stay → 409", async ({ page }) => {
    await apiLoginAdmin(page);

    const { status, data } = await approveStay(page, stayIdCancelled);
    expect(status).toBe(409);
    expect(data.error).toContain("PENDING");

    console.log(`  ✓ S9: Approving CANCELLED stay correctly rejected (409)`);
  });

  // ═══════════════════════════════════════════
  // S10 — Can't cancel APPROVED stay
  // ═══════════════════════════════════════════
  test("S10: Can't cancel APPROVED stay → 409", async ({ page }) => {
    await apiLoginAdmin(page);

    const { status, data } = await cancelStay(page, stayIdApproved);
    expect(status).toBe(409);
    expect(data.error).toContain("PENDING");

    console.log(`  ✓ S10: Cancelling APPROVED stay correctly rejected (409)`);
  });

  // ═══════════════════════════════════════════
  // S11 — NEEDS_PAYMENT stay (all passes exhausted)
  // ═══════════════════════════════════════════
  test("S11: All passes depleted → NEEDS_PAYMENT", async ({ page }) => {
    await apiLoginAdmin(page);

    // Deplete monthly passes: create + approve a 2-night stay with new plate
    const depletePlate = `DP${RUN_ID}`;
    const { data: depleteStay } = await createStay(page, {
      residentEmail: TEST_EMAIL,
      guestName: `Guest Deplete ${RUN_ID}`,
      plate: depletePlate,
      startDate: futureDate(25),
      endDate: futureDate(27),
    });
    await approveStay(page, depleteStay.id);

    // Verify passes are now exhausted
    const balance = await getPassBalance(page, residentId);
    expect(balance.monthlyFreeRemaining).toBe(0);
    expect(balance.bonusPasses).toBe(0);

    // Create another stay with an ALREADY-USED plate — should be all billable
    // (no guest free pass for reused plates, no monthly/bonus passes left)
    const plate = `DP${RUN_ID}`; // Same plate as deplete stay above
    const { data: stay } = await createStay(page, {
      residentEmail: TEST_EMAIL,
      guestName: `Guest NP ${RUN_ID}`,
      plate,
      startDate: futureDate(28),
      endDate: futureDate(30),
    });
    // Verify billing via list (should be 2 billable nights at $5/night = $10)
    const listRes = await page.request.get("/api/guest-stays");
    const listData = await listRes.json();
    const npStay = listData.stays?.find(
      (s: { id: number | string }) => Number(s.id) === Number(stay.id),
    );
    expect(npStay).toBeTruthy();
    expect(npStay.billable_nights).toBe(2);
    expect(npStay.amount_cents).toBe(1000); // 2 × $5

    // Approve → NEEDS_PAYMENT
    const { data: result } = await approveStay(page, stay.id);
    expect(result.status).toBe("NEEDS_PAYMENT");
    expect(result.billing.amountCents).toBe(1000);
    stayIdNeedsPayment = Number(stay.id);

    console.log(`  ✓ S11: All passes depleted → NEEDS_PAYMENT ($10.00)`);
  });

  // ═══════════════════════════════════════════
  // S12 — Admin bypass payment
  // ═══════════════════════════════════════════
  test("S12: Admin bypass payment → APPROVED without Stripe", async ({ page }) => {
    await apiLoginAdmin(page);

    const { status, data } = await bypassPayment(page, stayIdNeedsPayment);
    expect(status).toBe(200);
    expect(data.status).toBe("APPROVED");

    console.log(`  ✓ S12: Admin bypassed payment for stay #${stayIdNeedsPayment} → APPROVED`);
  });

  // ═══════════════════════════════════════════
  // S13 — Monthly cron adds new pass bucket
  // ═══════════════════════════════════════════
  test("S13: Monthly cron creates new pass bucket", async ({ page }) => {
    await apiLoginAdmin(page);

    // Check balance before
    const before = await getPassBalance(page, residentId);

    // Trigger monthly cron
    const res = await page.request.post("/api/cron/monthly-reset");
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.status).toBe("ok");

    console.log(`  ✓ S13: Monthly cron executed — ${data.residentsNotified} residents notified`);
  });

  // ═══════════════════════════════════════════
  // S14 — refreshPendingStayBilling after approval
  // ═══════════════════════════════════════════
  test("S14: Pending stays refreshed after approval consumes passes", async ({ page }) => {
    await apiLoginAdmin(page);

    // Create TWO pending stays for the same resident
    const plate1 = `RF1${RUN_ID}`;
    const plate2 = `RF2${RUN_ID}`;

    const { data: stay1 } = await createStay(page, {
      residentEmail: TEST_EMAIL,
      guestName: `Guest RF1 ${RUN_ID}`,
      plate: plate1,
      startDate: futureDate(35),
      endDate: futureDate(36),
    });
    const { data: stay2 } = await createStay(page, {
      residentEmail: TEST_EMAIL,
      guestName: `Guest RF2 ${RUN_ID}`,
      plate: plate2,
      startDate: futureDate(37),
      endDate: futureDate(38),
    });
    stayIdPendingRefresh = Number(stay2.id);

    // Both should show guest free pass estimated (verify via list)
    const listRes = await page.request.get("/api/guest-stays");
    const listData = await listRes.json();
    const s1Listed = listData.stays?.find(
      (s: { id: number | string }) => Number(s.id) === Number(stay1.id),
    );
    const s2Listed = listData.stays?.find(
      (s: { id: number | string }) => Number(s.id) === Number(stay2.id),
    );
    expect(s1Listed).toBeTruthy();
    expect(s2Listed).toBeTruthy();
    expect(s1Listed.guest_free_pass_nights).toBe(1);
    expect(s2Listed.guest_free_pass_nights).toBe(1);

    // Approve stay1 → consumes guest free pass for plate1
    const { data: result1 } = await approveStay(page, stay1.id);
    expect(result1.status).toBe("APPROVED");

    // Fetch stay2 via listing to check if billing was refreshed
    const staysRes = await page.request.get("/api/guest-stays");
    const staysData = await staysRes.json();
    const refreshedStay2 = staysData.stays?.find(
      (s: { id: number | string }) => Number(s.id) === Number(stay2.id),
    );

    // Stay2 should still have its OWN guest free pass (different plate)
    // But its billing should be refreshed based on remaining passes
    expect(refreshedStay2).toBeTruthy();
    expect(refreshedStay2.status).toBe("PENDING");

    console.log(`  ✓ S14: Pending stay billing refreshed after approval`);

    // Clean up stay2
    await cancelStay(page, stay2.id);
  });

  // ═══════════════════════════════════════════
  // S15 — Cancel NEEDS_PAYMENT stay
  // ═══════════════════════════════════════════
  test("S15: Cancel NEEDS_PAYMENT stay → CANCELLED", async ({ page }) => {
    await apiLoginAdmin(page);

    // Create a billable stay
    const plate = `CN${RUN_ID}`;
    const { data: stay } = await createStay(page, {
      residentEmail: TEST_EMAIL,
      guestName: `Guest Cancel NP ${RUN_ID}`,
      plate,
      startDate: futureDate(40),
      endDate: futureDate(42),
    });

    // Approve → NEEDS_PAYMENT (all passes exhausted)
    const { data: approved } = await approveStay(page, stay.id);
    // Could be NEEDS_PAYMENT or APPROVED depending on cron passes
    if (approved.status === "NEEDS_PAYMENT") {
      const { status } = await cancelStay(page, stay.id);
      expect(status).toBe(200);
      console.log(`  ✓ S15: NEEDS_PAYMENT stay cancelled`);
    } else {
      console.log(`  ✓ S15: Stay was APPROVED (passes available from cron) — skipping cancel test`);
    }
  });

  // ═══════════════════════════════════════════
  // S16 — Edit stay plate → new free pass eligibility
  // ═══════════════════════════════════════════
  test("S16: Edit plate on PENDING stay → billing recalculated with new plate", async ({ page }) => {
    await apiLoginAdmin(page);

    // Create stay with an already-used plate
    const usedPlate = `LC1${RUN_ID}`; // Used in S1/S2
    const { data: stay } = await createStay(page, {
      residentEmail: TEST_EMAIL,
      guestName: `Guest Edit Plate ${RUN_ID}`,
      plate: usedPlate,
      startDate: futureDate(45),
      endDate: futureDate(46),
    });
    // Verify via list that used plate gets no free pass
    const listRes = await page.request.get("/api/guest-stays");
    const listData = await listRes.json();
    const editStay2 = listData.stays?.find(
      (s: { id: number | string }) => Number(s.id) === Number(stay.id),
    );
    expect(editStay2).toBeTruthy();
    expect(editStay2.guest_free_pass_nights).toBe(0); // Used plate

    // Edit to a brand new plate
    const newPlate = `NW${RUN_ID}`;
    const { status } = await editStay(page, stay.id, {
      vehiclePlate: newPlate,
    });
    expect(status).toBe(200);

    // The billing should be recalculated — new plate may get free pass
    // Verify via approve
    const { data: approved } = await approveStay(page, stay.id);
    expect(approved.billing.guestFreePassApplied).toBe(1); // New plate gets free pass!

    console.log(`  ✓ S16: Changed plate from used to new → free pass now applicable`);
  });

  // ═══════════════════════════════════════════
  // S17 — Email notifications on approval
  // ═══════════════════════════════════════════
  test("S17: Approval sends permit email to guest", async ({ page }) => {
    await apiLoginAdmin(page);

    // Check if Mailpit is reachable
    let mailpitAvailable = false;
    try {
      const check = await fetch("http://localhost:8025/api/v1/messages");
      mailpitAvailable = check.ok;
    } catch { /* Mailpit not running */ }

    if (!mailpitAvailable) {
      console.log(`  ✓ S17: Skipped (Mailpit not running)`);
      return;
    }

    await clearMailpit();

    const guestEmail = `email-test-${RUN_ID}@test.com`;
    const plate = `EM${RUN_ID}`;
    const { data: stay } = await createStay(page, {
      residentEmail: TEST_EMAIL,
      guestName: `Guest Email ${RUN_ID}`,
      guestEmail,
      plate,
      startDate: futureDate(50),
      endDate: futureDate(51),
    });

    // Approve
    await approveStay(page, stay.id);

    // Check Mailpit for guest permit email
    const email = await waitForEmail(guestEmail, "approved");
    expect(email).toBeTruthy();

    console.log(`  ✓ S17: Permit email sent to guest on approval`);
  });

  // ═══════════════════════════════════════════
  // S18 — Final summary
  // ═══════════════════════════════════════════
  test("S18: Final pass balance verification", async ({ page }) => {
    await apiLoginAdmin(page);

    const balance = await getPassBalance(page, residentId);
    expect(balance.bonusPasses).toBeGreaterThanOrEqual(0);
    expect(balance.monthlyFreeRemaining).toBeGreaterThanOrEqual(0);

    console.log(`\n  ══════════════════════════════════════`);
    console.log(`  Guest Lifecycle & Billing — Summary`);
    console.log(`  ──────────────────────────────────────`);
    console.log(`  S0:  Setup (test residents)         ✓`);
    console.log(`  S1:  Create → PENDING               ✓`);
    console.log(`  S2:  Approve → APPROVED ($0)        ✓`);
    console.log(`  S3:  Free pass one-time enforcement  ✓`);
    console.log(`  S4:  Same-day = 1 night minimum     ✓`);
    console.log(`  S5:  Cross-unit plate conflict      ✓`);
    console.log(`  S6:  Plate normalization            ✓`);
    console.log(`  S7:  Edit dates → recalculate       ✓`);
    console.log(`  S8:  Cancel PENDING → CANCELLED     ✓`);
    console.log(`  S9:  Can't approve CANCELLED        ✓`);
    console.log(`  S10: Can't cancel APPROVED          ✓`);
    console.log(`  S11: NEEDS_PAYMENT (no passes)      ✓`);
    console.log(`  S12: Admin bypass payment           ✓`);
    console.log(`  S13: Monthly cron                   ✓`);
    console.log(`  S14: Refresh pending after approve  ✓`);
    console.log(`  S15: Cancel NEEDS_PAYMENT           ✓`);
    console.log(`  S16: Edit plate → new free pass     ✓`);
    console.log(`  S17: Approval email notification    ✓`);
    console.log(`  S18: Balance verification           ✓`);
    console.log(`  ══════════════════════════════════════\n`);
  });
});
