import { describe, it, expect, vi, beforeEach } from "vitest";

/* ================================================================
   6-MONTH SIMULATION TEST

   Simulates the full lifecycle of the pass and billing system
   across 6 months (January → June 2026).

   Models a real in-memory database with:
   - resident_free_pass_months table
   - guest_vehicle_free_pass table
   - residents table (bonus_free_nights)
   - guest_stays table

   Tests the billing engine, pass deductions, monthly cron resets,
   stale billing refresh for PENDING stays, and edge cases including:
   - Multi-resident interactions
   - Long-duration cross-month stays
   - Pass accumulation over many months
   - Returning guests with different plates
   - Multiple concurrent PENDING stays
   ================================================================ */

// ── In-memory database tables ──
interface PassBucket {
  resident_id: number;
  month_start: string;
  free_nights_total: number;
  free_nights_used: number;
}

interface VehicleFreePass {
  plate_number: string;
  free_pass: number;
  used: boolean;
  guest_stay_id: number | null;
}

interface Resident {
  id: number;
  bonus_free_nights: number;
}

interface GuestStay {
  id: number;
  unit_id: number;
  guest_id: number;
  start_date: string;
  end_date: string;
  vehicle_plate: string;
  status: string;
  requested_by_resident_id: number;
  passes_applied: number;
  guest_free_pass_nights: number;
  billable_nights: number;
  amount_cents: number;
}

let passBuckets: PassBucket[] = [];
let vehiclePasses: VehicleFreePass[] = [];
let residents: Resident[] = [];
let guestStays: GuestStay[] = [];
let nextStayId = 1;

// ── Mock dbQuery that simulates real SQL behavior ──
vi.mock("@/lib/db", () => ({
  dbQuery: vi.fn(async (sql: string, params: Record<string, unknown> = {}) => {
    const s = sql.trim().replace(/\s+/g, " ");

    // ── SELECT guest_vehicle_free_pass ──
    if (s.includes("guest_vehicle_free_pass") && s.includes("SELECT")) {
      const plate = (params.plate as string || "").toUpperCase().replace(/[\s-]/g, "");
      const found = vehiclePasses.find((vp) => vp.plate_number === plate);
      const rows = found ? [{ free_pass: found.free_pass, used: found.used }] : [];
      return Object.assign(rows, { insertId: null, rowCount: rows.length });
    }

    // ── UPDATE guest_vehicle_free_pass (mark used) ──
    if (s.includes("UPDATE guest_vehicle_free_pass") && s.includes("used = TRUE")) {
      const plate = (params.plate as string || "").toUpperCase().replace(/[\s-]/g, "");
      const vp = vehiclePasses.find((v) => v.plate_number === plate && !v.used);
      if (vp) {
        vp.used = true;
        vp.guest_stay_id = (params.stayId as number) || null;
      }
      return Object.assign([], { insertId: null, rowCount: vp ? 1 : 0 });
    }

    // ── SELECT bonus_free_nights ──
    if (s.includes("bonus_free_nights") && s.includes("SELECT")) {
      const res = residents.find((r) => r.id === (params.residentId as number));
      const rows = res ? [{ bonus_free_nights: res.bonus_free_nights }] : [{ bonus_free_nights: 0 }];
      return Object.assign(rows, { insertId: null, rowCount: 1 });
    }

    // ── UPDATE residents bonus_free_nights ──
    if (s.includes("UPDATE residents") && s.includes("bonus_free_nights")) {
      const res = residents.find((r) => r.id === (params.residentId as number));
      if (res) {
        res.bonus_free_nights = Math.max(0, res.bonus_free_nights - (params.bonusApplied as number || 0));
      }
      return Object.assign([], { insertId: null, rowCount: 1 });
    }

    // ── SELECT monthly buckets (pool) ──
    if (s.includes("resident_free_pass_months") && s.includes("SELECT") && s.includes("ORDER BY")) {
      const resId = params.residentId as number;
      const available = passBuckets
        .filter((b) => b.resident_id === resId && b.free_nights_used < b.free_nights_total)
        .sort((a, b) => a.month_start.localeCompare(b.month_start));
      return Object.assign(
        available.map((b) => ({
          month_start: b.month_start,
          free_nights_total: b.free_nights_total,
          free_nights_used: b.free_nights_used,
        })),
        { insertId: null, rowCount: available.length }
      );
    }

    // ── INSERT monthly bucket (ensureMonthlyBucket) ──
    if (s.includes("INSERT INTO resident_free_pass_months")) {
      const resId = params.residentId as number;
      const monthStart = params.monthStart as string;
      const existing = passBuckets.find(
        (b) => b.resident_id === resId && b.month_start === monthStart
      );
      if (!existing) {
        passBuckets.push({
          resident_id: resId,
          month_start: monthStart,
          free_nights_total: params.freeTotal as number || 1,
          free_nights_used: 0,
        });
      }
      return Object.assign([], { insertId: null, rowCount: existing ? 0 : 1 });
    }

    // ── UPDATE monthly bucket (debit passes on approve) ──
    if (s.includes("UPDATE resident_free_pass_months") && s.includes("free_nights_used")) {
      const resId = params.residentId as number;
      const monthStart = params.monthStart as string;
      const consumed = params.consumed as number;
      const bucket = passBuckets.find(
        (b) => b.resident_id === resId && b.month_start === monthStart
      );
      if (bucket) bucket.free_nights_used += consumed;
      return Object.assign([], { insertId: null, rowCount: bucket ? 1 : 0 });
    }

    // ── SELECT PENDING guest_stays (for refreshPendingStayBilling) ──
    if (s.includes("guest_stays") && s.includes("PENDING") && s.includes("SELECT")) {
      const resId = params.residentId as number;
      const pending = guestStays
        .filter((gs) => gs.requested_by_resident_id === resId && gs.status === "PENDING")
        .map((gs) => ({
          id: gs.id,
          start_date: gs.start_date,
          end_date: gs.end_date,
          vehicle_plate: gs.vehicle_plate,
        }));
      return Object.assign(pending, { insertId: null, rowCount: pending.length });
    }

    // ── UPDATE guest_stays (refresh billing) ──
    if (s.includes("UPDATE guest_stays") && s.includes("passes_applied")) {
      const id = params.id as number;
      const stay = guestStays.find((gs) => gs.id === id);
      if (stay) {
        stay.passes_applied = params.passesApplied as number;
        stay.guest_free_pass_nights = params.gfp as number;
        stay.billable_nights = params.billableNights as number;
        stay.amount_cents = params.amountCents as number;
      }
      return Object.assign([], { insertId: null, rowCount: stay ? 1 : 0 });
    }

    return Object.assign([], { insertId: null, rowCount: 0 });
  }),
  getDbPool: vi.fn(),
  dbTransaction: vi.fn(async (callback: (client: unknown) => Promise<void>) => {
    await callback(null);
  }),
}));

const { calculateStayBilling, refreshPendingStayBilling } = await import("@/lib/billing");

beforeEach(() => {
  passBuckets = [];
  vehiclePasses = [];
  residents = [];
  guestStays = [];
  nextStayId = 1;
  vi.clearAllMocks();
});

/* ================================================================
   Helper: simulate what the approve/auto-approve endpoint does
   ================================================================ */
async function simulateApprove(
  residentId: number,
  stayId: number,
  plateNumber: string
) {
  const stay = guestStays.find((s) => s.id === stayId);
  if (!stay) throw new Error(`Stay ${stayId} not found`);

  const billing = await calculateStayBilling(residentId, stay.start_date, stay.end_date, {
    plateNumber,
  });

  const gfp = billing.guestFreePassApplied || 0;
  const passesApplied =
    gfp + (billing.bonusNightsApplied || 0) + (billing.freeNightsApplied || 0);

  // Update stay record
  stay.status = billing.amountCents > 0 ? "NEEDS_PAYMENT" : "APPROVED";
  stay.passes_applied = passesApplied;
  stay.guest_free_pass_nights = gfp;
  stay.billable_nights = billing.billableNights;
  stay.amount_cents = billing.amountCents;

  // Debit monthly pass buckets
  for (const c of billing.monthConsumptions) {
    const bucket = passBuckets.find(
      (b) => b.resident_id === residentId && b.month_start === c.monthStart
    );
    if (bucket) bucket.free_nights_used += c.consumed;
  }

  // Debit bonus passes
  if (billing.bonusNightsApplied > 0) {
    const res = residents.find((r) => r.id === residentId);
    if (res) res.bonus_free_nights = Math.max(0, res.bonus_free_nights - billing.bonusNightsApplied);
  }

  // Mark vehicle free pass as used
  if (billing.guestFreePassApplied > 0) {
    const vp = vehiclePasses.find((v) => v.plate_number === plateNumber && !v.used);
    if (vp) {
      vp.used = true;
      vp.guest_stay_id = stayId;
    }
  }

  // Refresh all other PENDING stays
  await refreshPendingStayBilling(residentId);

  return billing;
}

/* Helper: simulate monthly cron */
function simulateMonthlyCron(monthStart: string) {
  // Add new monthly bucket for each resident (accumulated, not reset)
  for (const res of residents) {
    const existing = passBuckets.find(
      (b) => b.resident_id === res.id && b.month_start === monthStart
    );
    if (!existing) {
      passBuckets.push({
        resident_id: res.id,
        month_start: monthStart,
        free_nights_total: 1,
        free_nights_used: 0,
      });
    }
  }

  // Guest vehicle free passes are one-time only — NOT reset monthly
}

/* Helper: create a stay in the in-memory DB */
function createStay(
  residentId: number,
  plate: string,
  startDate: string,
  endDate: string,
  status = "PENDING"
): GuestStay {
  const stay: GuestStay = {
    id: nextStayId++,
    unit_id: 1,
    guest_id: 1,
    start_date: startDate,
    end_date: endDate,
    vehicle_plate: plate,
    status,
    requested_by_resident_id: residentId,
    passes_applied: 0,
    guest_free_pass_nights: 0,
    billable_nights: 0,
    amount_cents: 0,
  };
  guestStays.push(stay);
  return stay;
}

/* ================================================================
   3-MONTH SIMULATION
   ================================================================ */

describe("3-month simulation", () => {
  const ALICE = 100;
  const BOB = 200;

  beforeEach(() => {
    // Setup residents
    residents = [
      { id: ALICE, bonus_free_nights: 0 },
      { id: BOB, bonus_free_nights: 2 },
    ];

    // Simulate: cron already ran for January
    passBuckets = [
      { resident_id: ALICE, month_start: "2026-01-01", free_nights_total: 1, free_nights_used: 0 },
      { resident_id: BOB, month_start: "2026-01-01", free_nights_total: 1, free_nights_used: 0 },
    ];

    // Plates Alice and Bob's guests will use
    vehiclePasses = [
      { plate_number: "ALICE01", free_pass: 1, used: false, guest_stay_id: null },
      { plate_number: "BOB01", free_pass: 1, used: false, guest_stay_id: null },
      { plate_number: "BOB02", free_pass: 1, used: false, guest_stay_id: null },
    ];
  });

  it("full 3-month lifecycle with pass accumulation, depletion, and resets", async () => {
    // ═══════════════════════════════════════════
    // MONTH 1: JANUARY 2026
    // ═══════════════════════════════════════════

    // --- Alice: 2-night stay with new plate ---
    // Vehicle free: 1, Monthly Jan: 1 → 0 billable
    const aliceJanStay = createStay(ALICE, "ALICE01", "2026-01-10", "2026-01-12");
    const aliceJanBilling = await simulateApprove(ALICE, aliceJanStay.id, "ALICE01");

    expect(aliceJanBilling.totalNights).toBe(2);
    expect(aliceJanBilling.guestFreePassApplied).toBe(1);
    expect(aliceJanBilling.freeNightsApplied).toBe(1);
    expect(aliceJanBilling.billableNights).toBe(0);
    expect(aliceJanBilling.amountCents).toBe(0);
    expect(aliceJanStay.status).toBe("APPROVED");

    // Verify: Alice's Jan monthly pass is now used
    const aliceJanBucket = passBuckets.find(
      (b) => b.resident_id === ALICE && b.month_start === "2026-01-01"
    );
    expect(aliceJanBucket!.free_nights_used).toBe(1);

    // Verify: ALICE01 vehicle pass is now used
    expect(vehiclePasses.find((v) => v.plate_number === "ALICE01")!.used).toBe(true);

    // --- Bob: 5-night stay with new plate ---
    // Vehicle free: 1, Bonus: 2, Monthly Jan: 1 → 1 billable
    const bobJanStay = createStay(BOB, "BOB01", "2026-01-15", "2026-01-20");
    const bobJanBilling = await simulateApprove(BOB, bobJanStay.id, "BOB01");

    expect(bobJanBilling.totalNights).toBe(5);
    expect(bobJanBilling.guestFreePassApplied).toBe(1);
    expect(bobJanBilling.bonusNightsApplied).toBe(2);
    expect(bobJanBilling.freeNightsApplied).toBe(1);
    expect(bobJanBilling.billableNights).toBe(1);
    expect(bobJanBilling.amountCents).toBe(500);
    expect(bobJanStay.status).toBe("NEEDS_PAYMENT");

    // Bob: bonus passes depleted
    expect(residents.find((r) => r.id === BOB)!.bonus_free_nights).toBe(0);
    // Bob: Jan monthly pass used
    expect(
      passBuckets.find((b) => b.resident_id === BOB && b.month_start === "2026-01-01")!.free_nights_used
    ).toBe(1);

    // ═══════════════════════════════════════════
    // MONTH 2: FEBRUARY 2026 (cron runs)
    // ═══════════════════════════════════════════

    simulateMonthlyCron("2026-02-01");

    // Verify: Alice now has 2 buckets (Jan used, Feb unused)
    const aliceFebBuckets = passBuckets.filter((b) => b.resident_id === ALICE);
    expect(aliceFebBuckets).toHaveLength(2);
    expect(aliceFebBuckets.find((b) => b.month_start === "2026-02-01")!.free_nights_used).toBe(0);

    // Verify: Vehicle passes NOT reset (one-time only)
    expect(vehiclePasses.find((v) => v.plate_number === "ALICE01")!.used).toBe(true);
    expect(vehiclePasses.find((v) => v.plate_number === "BOB01")!.used).toBe(true);

    // --- Alice: same plate again in Feb (vehicle pass already consumed permanently) ---
    // Vehicle free: 0 (one-time), Monthly Feb: 1 → 1 billable for 2-night stay
    const aliceFebStay = createStay(ALICE, "ALICE01", "2026-02-05", "2026-02-07");
    const aliceFebBilling = await simulateApprove(ALICE, aliceFebStay.id, "ALICE01");

    expect(aliceFebBilling.guestFreePassApplied).toBe(0); // one-time vehicle pass already consumed
    expect(aliceFebBilling.freeNightsApplied).toBe(1);
    expect(aliceFebBilling.billableNights).toBe(1);
    expect(aliceFebStay.status).toBe("NEEDS_PAYMENT");

    // Alice: Feb monthly used, Jan was already used
    expect(
      passBuckets.find((b) => b.resident_id === ALICE && b.month_start === "2026-02-01")!.free_nights_used
    ).toBe(1);

    // --- Alice: another 3-night stay in Feb (no passes left) ---
    const aliceFeb2Stay = createStay(ALICE, "ALICE01", "2026-02-15", "2026-02-18");
    const aliceFeb2Billing = await simulateApprove(ALICE, aliceFeb2Stay.id, "ALICE01");

    expect(aliceFeb2Billing.guestFreePassApplied).toBe(0); // vehicle pass already used this month
    expect(aliceFeb2Billing.freeNightsApplied).toBe(0); // all monthly passes used
    expect(aliceFeb2Billing.billableNights).toBe(3);
    expect(aliceFeb2Billing.amountCents).toBe(1500);
    expect(aliceFeb2Stay.status).toBe("NEEDS_PAYMENT");

    // ═══════════════════════════════════════════
    // MONTH 3: MARCH 2026 (cron runs)
    // ═══════════════════════════════════════════

    simulateMonthlyCron("2026-03-01");

    // Verify: Alice now has 3 buckets total
    const aliceMarBuckets = passBuckets.filter((b) => b.resident_id === ALICE);
    expect(aliceMarBuckets).toHaveLength(3);

    // Alice only has 1 monthly pass remaining (March)
    // Jan and Feb are fully used
    const aliceAvailable = aliceMarBuckets.filter(
      (b) => b.free_nights_used < b.free_nights_total
    );
    expect(aliceAvailable).toHaveLength(1);
    expect(aliceAvailable[0].month_start).toBe("2026-03-01");

    // --- Alice: 1-night stay in March with same plate ---
    // Vehicle free: 0 (one-time, already consumed), monthly Mar: 1 → covered
    const aliceMarStay = createStay(ALICE, "ALICE01", "2026-03-10", "2026-03-11");
    const aliceMarBilling = await simulateApprove(ALICE, aliceMarStay.id, "ALICE01");

    expect(aliceMarBilling.totalNights).toBe(1);
    expect(aliceMarBilling.guestFreePassApplied).toBe(0); // one-time vehicle pass already consumed
    expect(aliceMarBilling.freeNightsApplied).toBe(1); // monthly pass covers it
    expect(aliceMarBilling.billableNights).toBe(0);
    expect(aliceMarStay.status).toBe("APPROVED");
    // Monthly March pass consumed
    expect(
      passBuckets.find((b) => b.resident_id === ALICE && b.month_start === "2026-03-01")!.free_nights_used
    ).toBe(1);

    // --- Bob: unused passes accumulated (Jan used, Feb+Mar unused) ---
    // Bob should have 2 monthly remaining (Feb + Mar)
    const bobBuckets = passBuckets.filter((b) => b.resident_id === BOB);
    expect(bobBuckets).toHaveLength(3);
    const bobAvailable = bobBuckets.filter((b) => b.free_nights_used < b.free_nights_total);
    expect(bobAvailable).toHaveLength(2);

    // --- Bob: 4-night stay, uses accumulated passes from oldest first ---
    const bobMarStay = createStay(BOB, "BOB02", "2026-03-15", "2026-03-19");
    const bobMarBilling = await simulateApprove(BOB, bobMarStay.id, "BOB02");

    expect(bobMarBilling.totalNights).toBe(4);
    expect(bobMarBilling.guestFreePassApplied).toBe(1); // vehicle free (BOB02 unused)
    expect(bobMarBilling.bonusNightsApplied).toBe(0); // depleted in Jan
    expect(bobMarBilling.freeNightsApplied).toBe(2); // Feb + Mar passes
    expect(bobMarBilling.billableNights).toBe(1);
    expect(bobMarBilling.amountCents).toBe(500);

    // Verify oldest-first: Feb bucket consumed before Mar
    expect(
      passBuckets.find((b) => b.resident_id === BOB && b.month_start === "2026-02-01")!.free_nights_used
    ).toBe(1);
    expect(
      passBuckets.find((b) => b.resident_id === BOB && b.month_start === "2026-03-01")!.free_nights_used
    ).toBe(1);
  });

  /* ================================================================
     PENDING STAY STALE BILLING TEST
     ================================================================ */

  it("PENDING stays get billing refreshed when another stay consumes passes", async () => {
    // Alice has 1 monthly pass (Jan)
    // Create a PENDING stay first
    const pendingStay = createStay(ALICE, "ALICE01", "2026-01-20", "2026-01-23");

    // Estimate billing for the PENDING stay
    const estimate = await calculateStayBilling(ALICE, "2026-01-20", "2026-01-23", {
      plateNumber: "ALICE01",
    });
    pendingStay.passes_applied = estimate.guestFreePassApplied + estimate.freeNightsApplied;
    pendingStay.guest_free_pass_nights = estimate.guestFreePassApplied;
    pendingStay.billable_nights = estimate.billableNights;
    pendingStay.amount_cents = estimate.amountCents;

    // PENDING stay estimates: vehicle free (1) + monthly (1) = 2 passes, 1 billable
    expect(estimate.guestFreePassApplied).toBe(1);
    expect(estimate.freeNightsApplied).toBe(1);
    expect(estimate.billableNights).toBe(1);
    expect(estimate.amountCents).toBe(500);
    expect(pendingStay.passes_applied).toBe(2);

    // Now Alice auto-approves a DIFFERENT stay that consumes all passes
    const urgentStay = createStay(ALICE, "ALICE01", "2026-01-10", "2026-01-12");
    await simulateApprove(ALICE, urgentStay.id, "ALICE01");

    // Urgent stay consumed: vehicle free (1) + monthly Jan (1) = 0 billable
    expect(urgentStay.status).toBe("APPROVED");
    expect(urgentStay.amount_cents).toBe(0);

    // The PENDING stay's billing should now be refreshed (stale data updated)
    // Vehicle pass: used → 0
    // Monthly pass: used → 0
    // So now: 3 nights, 0 passes → 3 billable = $15
    expect(pendingStay.passes_applied).toBe(0);
    expect(pendingStay.guest_free_pass_nights).toBe(0);
    expect(pendingStay.billable_nights).toBe(3);
    expect(pendingStay.amount_cents).toBe(1500);
  });

  /* ================================================================
     CROSS-MONTH STAY TEST
     ================================================================ */

  it("stay crossing month boundary uses correct month buckets", async () => {
    // Alice has Jan + Feb monthly passes
    passBuckets.push({
      resident_id: ALICE,
      month_start: "2026-02-01",
      free_nights_total: 1,
      free_nights_used: 0,
    });

    // Stay: Jan 28 → Feb 3 (6 nights: 3 in Jan, 3 in Feb)
    const crossStay = createStay(ALICE, "ALICE01", "2026-01-28", "2026-02-03");
    const billing = await simulateApprove(ALICE, crossStay.id, "ALICE01");

    expect(billing.totalNights).toBe(6);
    expect(billing.guestFreePassApplied).toBe(1); // vehicle free
    expect(billing.freeNightsApplied).toBe(2); // Jan (1) + Feb (1)
    expect(billing.billableNights).toBe(3);
    expect(billing.amountCents).toBe(1500);

    // Both month buckets consumed
    expect(
      passBuckets.find((b) => b.resident_id === ALICE && b.month_start === "2026-01-01")!.free_nights_used
    ).toBe(1);
    expect(
      passBuckets.find((b) => b.resident_id === ALICE && b.month_start === "2026-02-01")!.free_nights_used
    ).toBe(1);
  });

  /* ================================================================
     MULTIPLE PENDING STAYS + DOUBLE-BOOKING EDGE CASE
     ================================================================ */

  it("multiple PENDING stays each independently estimate current balance", async () => {
    // Alice has 1 monthly pass
    const stay1 = createStay(ALICE, "ALICE01", "2026-01-10", "2026-01-12"); // 2 nights
    const stay2 = createStay(ALICE, "ALICE01", "2026-01-15", "2026-01-17"); // 2 nights

    // Estimate both
    for (const s of [stay1, stay2]) {
      const est = await calculateStayBilling(ALICE, s.start_date, s.end_date, {
        plateNumber: s.vehicle_plate,
      });
      s.passes_applied = est.guestFreePassApplied + est.freeNightsApplied;
      s.billable_nights = est.billableNights;
      s.amount_cents = est.amountCents;
    }

    // Both see the same balance: vehicle free + 1 monthly = 2 passes
    // Both estimate 0 billable (2 nights, 2 passes available)
    expect(stay1.amount_cents).toBe(0);
    expect(stay2.amount_cents).toBe(0);

    // Approve stay1 → consumes passes
    await simulateApprove(ALICE, stay1.id, "ALICE01");

    // stay2 (still PENDING) should now be refreshed with updated billing
    // Passes gone: 2 nights, 0 passes → 2 billable = $10
    expect(stay2.billable_nights).toBe(2);
    expect(stay2.amount_cents).toBe(1000);
    expect(stay2.passes_applied).toBe(0);
  });

  /* ================================================================
     VEHICLE FREE PASS ONE-TIME-ONLY TEST
     ================================================================ */

  it("vehicle free pass is one-time only and never resets", async () => {
    // January: Alice uses ALICE01 plate → vehicle free used
    const janStay = createStay(ALICE, "ALICE01", "2026-01-05", "2026-01-06");
    const janBilling = await simulateApprove(ALICE, janStay.id, "ALICE01");
    expect(janBilling.guestFreePassApplied).toBe(1);
    expect(vehiclePasses.find((v) => v.plate_number === "ALICE01")!.used).toBe(true);

    // Cron: February — vehicle pass should NOT reset
    simulateMonthlyCron("2026-02-01");
    expect(vehiclePasses.find((v) => v.plate_number === "ALICE01")!.used).toBe(true);

    // February: Same plate does NOT get vehicle free again — uses monthly pass instead
    const febStay = createStay(ALICE, "ALICE01", "2026-02-05", "2026-02-06");
    const febBilling = await simulateApprove(ALICE, febStay.id, "ALICE01");
    expect(febBilling.guestFreePassApplied).toBe(0);
    expect(febBilling.freeNightsApplied).toBe(1); // monthly pass covers it

    // Cron: March
    simulateMonthlyCron("2026-03-01");

    // March: Still no vehicle free — plate is permanently used
    expect(vehiclePasses.find((v) => v.plate_number === "ALICE01")!.used).toBe(true);
  });

  /* ================================================================
     BONUS PASS DEPLETION TEST
     ================================================================ */

  it("bonus passes deplete and don't regenerate", async () => {
    // Bob starts with 2 bonus passes
    expect(residents.find((r) => r.id === BOB)!.bonus_free_nights).toBe(2);

    // Jan: 3-night stay (vehicle free=1 + bonus=2 → all covered, monthly NOT touched)
    const janStay = createStay(BOB, "BOB01", "2026-01-10", "2026-01-13");
    const janBilling = await simulateApprove(BOB, janStay.id, "BOB01");
    expect(janBilling.guestFreePassApplied).toBe(1);
    expect(janBilling.bonusNightsApplied).toBe(2);
    expect(janBilling.freeNightsApplied).toBe(0); // monthly NOT consumed (bonus covered all)
    expect(janBilling.billableNights).toBe(0);
    expect(residents.find((r) => r.id === BOB)!.bonus_free_nights).toBe(0);

    // Cron: February
    simulateMonthlyCron("2026-02-01");

    // Bonus passes still 0 (don't regenerate)
    expect(residents.find((r) => r.id === BOB)!.bonus_free_nights).toBe(0);

    // Feb: 3-night stay. Bob has Jan (unused) + Feb (new) = 2 accumulated monthly passes
    // vehicle free already consumed in Jan (one-time) + 2 monthly = 2 → 1 billable
    const febStay = createStay(BOB, "BOB01", "2026-02-10", "2026-02-13");
    const febBilling = await simulateApprove(BOB, febStay.id, "BOB01");
    expect(febBilling.bonusNightsApplied).toBe(0);
    expect(febBilling.guestFreePassApplied).toBe(0); // one-time vehicle pass already consumed
    expect(febBilling.freeNightsApplied).toBe(2); // Jan (accumulated) + Feb
    expect(febBilling.billableNights).toBe(1);
  });

  /* ================================================================
     ZERO-PASS RESIDENT (always pays)
     ================================================================ */

  it("resident with no pre-existing buckets still gets monthly pass via ensureMonthlyBucket", async () => {
    // New resident with 0 bonus, no monthly buckets initially
    residents.push({ id: 300, bonus_free_nights: 0 });

    // No vehicle pass either
    const stay = createStay(300, "UNKNOWN", "2026-01-10", "2026-01-15");
    const billing = await calculateStayBilling(300, stay.start_date, stay.end_date, {
      plateNumber: "UNKNOWN",
    });

    // ensureMonthlyBucket creates Jan bucket → 1 free night applied
    expect(billing.totalNights).toBe(5);
    expect(billing.guestFreePassApplied).toBe(0);
    expect(billing.bonusNightsApplied).toBe(0);
    expect(billing.freeNightsApplied).toBe(1);
    expect(billing.billableNights).toBe(4);
    expect(billing.amountCents).toBe(2000);
  });
});

/* ================================================================
   6-MONTH SIMULATION (Jan → June 2026)

   Tests 4 residents over 6 months with varied usage patterns:
   - ALICE: Moderate user, same plate, uses passes steadily
   - BOB:   Heavy user, multiple plates, bonus depletion
   - CAROL: Inactive for months, then uses accumulated passes
   - DAVE:  No passes at all, always pays
   ================================================================ */

describe("6-month simulation", () => {
  const ALICE = 100;
  const BOB = 200;
  const CAROL = 300;
  const DAVE = 400;

  beforeEach(() => {
    residents = [
      { id: ALICE, bonus_free_nights: 0 },
      { id: BOB, bonus_free_nights: 3 },
      { id: CAROL, bonus_free_nights: 0 },
      { id: DAVE, bonus_free_nights: 0 },
    ];

    // January buckets (cron already ran)
    passBuckets = [
      { resident_id: ALICE, month_start: "2026-01-01", free_nights_total: 1, free_nights_used: 0 },
      { resident_id: BOB, month_start: "2026-01-01", free_nights_total: 1, free_nights_used: 0 },
      { resident_id: CAROL, month_start: "2026-01-01", free_nights_total: 1, free_nights_used: 0 },
      { resident_id: DAVE, month_start: "2026-01-01", free_nights_total: 1, free_nights_used: 0 },
    ];

    vehiclePasses = [
      { plate_number: "ALICE01", free_pass: 1, used: false, guest_stay_id: null },
      { plate_number: "BOB01", free_pass: 1, used: false, guest_stay_id: null },
      { plate_number: "BOB02", free_pass: 1, used: false, guest_stay_id: null },
      { plate_number: "BOB03", free_pass: 1, used: false, guest_stay_id: null },
      { plate_number: "CAROL01", free_pass: 1, used: false, guest_stay_id: null },
      // Dave has no vehicle pass entries
    ];
  });

  it("full 6-month lifecycle across 4 residents", async () => {
    // ═══════════════════════════════════════════
    // MONTH 1: JANUARY 2026
    // ═══════════════════════════════════════════

    // Alice: 2-night stay → vehicle(1) + monthly(1) = fully covered
    const aliceJan = createStay(ALICE, "ALICE01", "2026-01-10", "2026-01-12");
    const aliceJanB = await simulateApprove(ALICE, aliceJan.id, "ALICE01");
    expect(aliceJanB.billableNights).toBe(0);
    expect(aliceJan.status).toBe("APPROVED");

    // Bob: 6-night stay → vehicle(1) + bonus(3) + monthly(1) = 5 covered, 1 billable
    const bobJan = createStay(BOB, "BOB01", "2026-01-05", "2026-01-11");
    const bobJanB = await simulateApprove(BOB, bobJan.id, "BOB01");
    expect(bobJanB.totalNights).toBe(6);
    expect(bobJanB.guestFreePassApplied).toBe(1);
    expect(bobJanB.bonusNightsApplied).toBe(3);
    expect(bobJanB.freeNightsApplied).toBe(1);
    expect(bobJanB.billableNights).toBe(1);
    expect(bobJanB.amountCents).toBe(500);
    expect(residents.find((r) => r.id === BOB)!.bonus_free_nights).toBe(0);

    // Carol: does NOT book in January (saving passes)
    // Dave: 3-night stay, no vehicle pass → monthly(1) = 2 billable
    const daveJan = createStay(DAVE, "DAVE01", "2026-01-15", "2026-01-18");
    const daveJanB = await simulateApprove(DAVE, daveJan.id, "DAVE01");
    expect(daveJanB.guestFreePassApplied).toBe(0); // no vehicle pass
    expect(daveJanB.freeNightsApplied).toBe(1);
    expect(daveJanB.billableNights).toBe(2);
    expect(daveJanB.amountCents).toBe(1000);

    // ═══════════════════════════════════════════
    // MONTH 2: FEBRUARY 2026
    // ═══════════════════════════════════════════

    simulateMonthlyCron("2026-02-01");

    // Verify bucket counts
    expect(passBuckets.filter((b) => b.resident_id === ALICE)).toHaveLength(2);
    expect(passBuckets.filter((b) => b.resident_id === BOB)).toHaveLength(2);
    expect(passBuckets.filter((b) => b.resident_id === CAROL)).toHaveLength(2);

    // Alice: 1-night stay with same plate (one-time vehicle pass already used) → monthly pass covers it
    const aliceFeb = createStay(ALICE, "ALICE01", "2026-02-14", "2026-02-15");
    const aliceFebB = await simulateApprove(ALICE, aliceFeb.id, "ALICE01");
    expect(aliceFebB.guestFreePassApplied).toBe(0); // vehicle pass already consumed permanently
    expect(aliceFebB.freeNightsApplied).toBe(1); // monthly pass used instead
    expect(aliceFebB.billableNights).toBe(0);
    // Feb monthly pass consumed
    expect(
      passBuckets.find((b) => b.resident_id === ALICE && b.month_start === "2026-02-01")!.free_nights_used
    ).toBe(1);

    // Bob: cross-month stay Feb 25 → Mar 3 (6 nights: 3 Feb + 3 Mar)
    // Vehicle pass already used in Jan (one-time) → Feb monthly(1) + Mar monthly(1, ensured) = 2 covered → 4 billable
    // (Bob has no bonus left; ensureMonthlyBucket creates Mar bucket)
    const bobCross = createStay(BOB, "BOB01", "2026-02-25", "2026-03-03");
    const bobCrossB = await simulateApprove(BOB, bobCross.id, "BOB01");
    expect(bobCrossB.totalNights).toBe(6);
    expect(bobCrossB.guestFreePassApplied).toBe(0); // one-time vehicle pass already consumed
    expect(bobCrossB.bonusNightsApplied).toBe(0);
    expect(bobCrossB.freeNightsApplied).toBe(2); // Feb monthly + Mar (ensured)
    expect(bobCrossB.billableNights).toBe(4);
    expect(bobCrossB.amountCents).toBe(2000);

    // Carol: still inactive
    // Dave: 1-night stay, no vehicle pass → Feb monthly covers it
    const daveFeb = createStay(DAVE, "DAVE01", "2026-02-10", "2026-02-11");
    const daveFebB = await simulateApprove(DAVE, daveFeb.id, "DAVE01");
    expect(daveFebB.freeNightsApplied).toBe(1);
    expect(daveFebB.billableNights).toBe(0);

    // ═══════════════════════════════════════════
    // MONTH 3: MARCH 2026
    // ═══════════════════════════════════════════

    simulateMonthlyCron("2026-03-01");

    // Carol: still inactive (accumulating: Jan + Feb + Mar = 3 monthly passes)
    const carolBuckets = passBuckets.filter((b) => b.resident_id === CAROL);
    expect(carolBuckets).toHaveLength(3);
    const carolAvailable = carolBuckets.filter((b) => b.free_nights_used < b.free_nights_total);
    expect(carolAvailable).toHaveLength(3);

    // Alice: 4-night stay in March → vehicle pass already used (one-time) + Mar monthly(1) = 1, billable 3
    // (Feb monthly was consumed in Feb stay above)
    const aliceMar = createStay(ALICE, "ALICE01", "2026-03-10", "2026-03-14");
    const aliceMarB = await simulateApprove(ALICE, aliceMar.id, "ALICE01");
    expect(aliceMarB.totalNights).toBe(4);
    expect(aliceMarB.guestFreePassApplied).toBe(0); // one-time vehicle pass already consumed
    expect(aliceMarB.freeNightsApplied).toBe(1); // Mar monthly only (Feb was used)
    expect(aliceMarB.billableNights).toBe(3);

    // Bob: different plate in March → vehicle(1) but Mar monthly already consumed by cross-month stay
    const bobMar = createStay(BOB, "BOB02", "2026-03-15", "2026-03-17");
    const bobMarB = await simulateApprove(BOB, bobMar.id, "BOB02");
    expect(bobMarB.guestFreePassApplied).toBe(1);
    expect(bobMarB.freeNightsApplied).toBe(0); // Mar monthly already used by cross-month stay
    expect(bobMarB.billableNights).toBe(1);

    // ═══════════════════════════════════════════
    // MONTH 4: APRIL 2026
    // ═══════════════════════════════════════════

    simulateMonthlyCron("2026-04-01");

    // Carol: NOW she uses 4 months of accumulated passes (Jan+Feb+Mar+Apr = 4 monthly)
    // + vehicle pass = 5 free nights total for a 5-night stay
    const carolApr = createStay(CAROL, "CAROL01", "2026-04-05", "2026-04-10");
    const carolAprB = await simulateApprove(CAROL, carolApr.id, "CAROL01");
    expect(carolAprB.totalNights).toBe(5);
    expect(carolAprB.guestFreePassApplied).toBe(1);
    expect(carolAprB.freeNightsApplied).toBe(4); // Jan + Feb + Mar + Apr
    expect(carolAprB.billableNights).toBe(0);
    expect(carolAprB.amountCents).toBe(0);
    expect(carolApr.status).toBe("APPROVED");

    // Verify oldest-first consumption for Carol
    expect(passBuckets.find((b) => b.resident_id === CAROL && b.month_start === "2026-01-01")!.free_nights_used).toBe(1);
    expect(passBuckets.find((b) => b.resident_id === CAROL && b.month_start === "2026-02-01")!.free_nights_used).toBe(1);
    expect(passBuckets.find((b) => b.resident_id === CAROL && b.month_start === "2026-03-01")!.free_nights_used).toBe(1);
    expect(passBuckets.find((b) => b.resident_id === CAROL && b.month_start === "2026-04-01")!.free_nights_used).toBe(1);

    // Dave: 7-night stay, no vehicle pass → Mar(1, unused) + Apr(1) = 2 monthly, 5 billable
    const daveApr = createStay(DAVE, "DAVE01", "2026-04-01", "2026-04-08");
    const daveAprB = await simulateApprove(DAVE, daveApr.id, "DAVE01");
    expect(daveAprB.guestFreePassApplied).toBe(0);
    expect(daveAprB.freeNightsApplied).toBe(2); // Mar (unused) + Apr
    expect(daveAprB.billableNights).toBe(5);
    expect(daveAprB.amountCents).toBe(2500);

    // ═══════════════════════════════════════════
    // MONTH 5: MAY 2026
    // ═══════════════════════════════════════════

    simulateMonthlyCron("2026-05-01");

    // Alice: long cross-month stay May 28 → Jun 5 (8 nights: 4 May + 4 Jun)
    // Alice has: vehicle pass already used (one-time). Apr + May monthly = 2 remaining
    // 2 monthly covered → 6 billable
    const aliceMayJun = createStay(ALICE, "ALICE01", "2026-05-28", "2026-06-05");
    const aliceMayJunB = await simulateApprove(ALICE, aliceMayJun.id, "ALICE01");
    expect(aliceMayJunB.totalNights).toBe(8);
    expect(aliceMayJunB.guestFreePassApplied).toBe(0); // one-time vehicle pass already consumed
    expect(aliceMayJunB.freeNightsApplied).toBe(2); // Apr + May
    expect(aliceMayJunB.billableNights).toBe(6);
    expect(aliceMayJunB.amountCents).toBe(3000);
    expect(aliceMayJunB.months).toHaveLength(2);
    expect(aliceMayJunB.months[0].monthStart).toBe("2026-05-01");
    expect(aliceMayJunB.months[0].nights).toBe(4); // May 28,29,30,31
    expect(aliceMayJunB.months[1].monthStart).toBe("2026-06-01");
    expect(aliceMayJunB.months[1].nights).toBe(4); // Jun 1,2,3,4

    // Bob: third plate in May → vehicle(1) for 1-night stay, free
    const bobMay = createStay(BOB, "BOB03", "2026-05-10", "2026-05-11");
    const bobMayB = await simulateApprove(BOB, bobMay.id, "BOB03");
    expect(bobMayB.guestFreePassApplied).toBe(1);
    expect(bobMayB.billableNights).toBe(0);

    // Carol: another short stay after depleting accumulated passes
    // Carol has only May monthly(1) left, vehicle pass already used in Apr (one-time)
    const carolMay = createStay(CAROL, "CAROL01", "2026-05-15", "2026-05-19");
    const carolMayB = await simulateApprove(CAROL, carolMay.id, "CAROL01");
    expect(carolMayB.totalNights).toBe(4);
    expect(carolMayB.guestFreePassApplied).toBe(0); // one-time vehicle pass already consumed
    expect(carolMayB.freeNightsApplied).toBe(1); // only May monthly left
    expect(carolMayB.billableNights).toBe(3);
    expect(carolMayB.amountCents).toBe(1500);

    // ═══════════════════════════════════════════
    // MONTH 6: JUNE 2026
    // ═══════════════════════════════════════════

    simulateMonthlyCron("2026-06-01");

    // Verify total bucket counts (6 months of accumulation)
    expect(passBuckets.filter((b) => b.resident_id === ALICE)).toHaveLength(6);
    expect(passBuckets.filter((b) => b.resident_id === BOB)).toHaveLength(6);
    expect(passBuckets.filter((b) => b.resident_id === CAROL)).toHaveLength(6);
    expect(passBuckets.filter((b) => b.resident_id === DAVE)).toHaveLength(6);

    // Bob: returning guest with BOB01 plate (vehicle pass already used in Jan, one-time)
    // Bob has: Apr(unused) + May(unused since used BOB03) + Jun(new) = 3 remaining monthly
    // No vehicle pass = 3 covered
    const bobJun = createStay(BOB, "BOB01", "2026-06-10", "2026-06-15");
    const bobJunB = await simulateApprove(BOB, bobJun.id, "BOB01");
    expect(bobJunB.totalNights).toBe(5);
    expect(bobJunB.guestFreePassApplied).toBe(0); // one-time vehicle pass already consumed
    expect(bobJunB.freeNightsApplied).toBe(3); // Apr + May + Jun
    expect(bobJunB.billableNights).toBe(2);
    expect(bobJunB.amountCents).toBe(1000);

    // Alice: all monthly passes used (Jan→May used, Jun new = 1)
    // Vehicle pass already used (one-time)
    const aliceJun = createStay(ALICE, "ALICE01", "2026-06-15", "2026-06-18");
    const aliceJunB = await simulateApprove(ALICE, aliceJun.id, "ALICE01");
    expect(aliceJunB.totalNights).toBe(3);
    expect(aliceJunB.guestFreePassApplied).toBe(0); // one-time vehicle pass already consumed
    expect(aliceJunB.freeNightsApplied).toBe(1); // only Jun
    expect(aliceJunB.billableNights).toBe(2);
    expect(aliceJunB.amountCents).toBe(1000);

    // Dave: still no vehicle pass. May(1, unused) + Jun(1, new) = 2 monthly
    const daveJun = createStay(DAVE, "DAVE01", "2026-06-20", "2026-06-25");
    const daveJunB = await simulateApprove(DAVE, daveJun.id, "DAVE01");
    expect(daveJunB.totalNights).toBe(5);
    expect(daveJunB.freeNightsApplied).toBe(2); // May (unused) + Jun
    expect(daveJunB.billableNights).toBe(3);
    expect(daveJunB.amountCents).toBe(1500);

    // ═══════════════════════════════════════════
    // FINAL ASSERTIONS: cumulative state
    // ═══════════════════════════════════════════

    // All bonus passes remain depleted
    expect(residents.find((r) => r.id === BOB)!.bonus_free_nights).toBe(0);
    expect(residents.find((r) => r.id === ALICE)!.bonus_free_nights).toBe(0);

    // Total stays created (4 residents × ~4 stays each, minus Carol who started late)
    expect(guestStays).toHaveLength(16);
  });

  /* ================================================================
     EDGE CASE: Long stay spanning 3+ months
     ================================================================ */

  it("very long stay spanning April → June (3 months)", async () => {
    // Give Alice passes for all months
    simulateMonthlyCron("2026-02-01");
    simulateMonthlyCron("2026-03-01");
    simulateMonthlyCron("2026-04-01");
    simulateMonthlyCron("2026-05-01");
    simulateMonthlyCron("2026-06-01");

    // Alice: 60-night stay Apr 1 → May 31 (30 Apr + 30 May)
    const longStay = createStay(ALICE, "ALICE01", "2026-04-01", "2026-05-31");
    const billing = await simulateApprove(ALICE, longStay.id, "ALICE01");

    expect(billing.totalNights).toBe(60);
    expect(billing.guestFreePassApplied).toBe(1); // vehicle
    // Monthly: Jan(1) + Feb(1) + Mar(1) + Apr(1) + May(1) + Jun(1) = 6 available, all consumed
    expect(billing.freeNightsApplied).toBe(6);
    expect(billing.billableNights).toBe(53); // 60 - 1 vehicle - 6 monthly
    expect(billing.amountCents).toBe(53 * 500);
    expect(billing.months).toHaveLength(2);
    expect(billing.months[0].nights).toBe(30); // April
    expect(billing.months[1].nights).toBe(30); // May
  });

  /* ================================================================
     EDGE CASE: Returning guest — same resident, different plates
     ================================================================ */

  it("returning guest uses different plates across months", async () => {
    simulateMonthlyCron("2026-02-01");
    simulateMonthlyCron("2026-03-01");

    // Bob: Jan stay with BOB01
    const bobJan = createStay(BOB, "BOB01", "2026-01-10", "2026-01-11");
    const bobJanB = await simulateApprove(BOB, bobJan.id, "BOB01");
    expect(bobJanB.guestFreePassApplied).toBe(1);

    // Bob: Feb stay with BOB02 (different plate → vehicle free again!)
    const bobFeb = createStay(BOB, "BOB02", "2026-02-10", "2026-02-11");
    const bobFebB = await simulateApprove(BOB, bobFeb.id, "BOB02");
    expect(bobFebB.guestFreePassApplied).toBe(1);

    // Bob: Mar stay with BOB03 (yet another plate → vehicle free again!)
    const bobMar = createStay(BOB, "BOB03", "2026-03-10", "2026-03-11");
    const bobMarB = await simulateApprove(BOB, bobMar.id, "BOB03");
    expect(bobMarB.guestFreePassApplied).toBe(1);

    // All 3 vehicle passes used
    expect(vehiclePasses.filter((v) => v.used)).toHaveLength(3);
  });

  /* ================================================================
     EDGE CASE: Multiple PENDING stays across months, approve in reverse order
     ================================================================ */

  it("approving stays in reverse chronological order refreshes remaining PENDING correctly", async () => {
    simulateMonthlyCron("2026-02-01");
    simulateMonthlyCron("2026-03-01");

    // Alice creates 3 PENDING stays
    const stayJan = createStay(ALICE, "ALICE01", "2026-01-10", "2026-01-12"); // 2 nights
    const stayFeb = createStay(ALICE, "ALICE01", "2026-02-10", "2026-02-12"); // 2 nights
    const stayMar = createStay(ALICE, "ALICE01", "2026-03-10", "2026-03-12"); // 2 nights

    // Estimate all
    for (const s of [stayJan, stayFeb, stayMar]) {
      const est = await calculateStayBilling(ALICE, s.start_date, s.end_date, {
        plateNumber: s.vehicle_plate,
      });
      s.passes_applied = est.guestFreePassApplied + est.freeNightsApplied;
      s.billable_nights = est.billableNights;
      s.amount_cents = est.amountCents;
    }

    // Each estimates 2 nights with vehicle(1) + 3 monthly available = free
    expect(stayJan.amount_cents).toBe(0);
    expect(stayFeb.amount_cents).toBe(0);
    expect(stayMar.amount_cents).toBe(0);

    // Approve March FIRST (reverse order)
    // stayMar: 2 nights, vehicle(1) + oldest monthly Jan(1) → 0 billable
    await simulateApprove(ALICE, stayMar.id, "ALICE01");
    expect(stayMar.status).toBe("APPROVED");
    expect(stayMar.amount_cents).toBe(0);

    // After stayMar approved: vehicle used, Jan monthly consumed.
    // Remaining pool: Feb(1) + Mar(1) = 2 monthly passes
    // Jan and Feb PENDING stays refreshed: vehicle used, but Feb+Mar monthly cover 2 nights each
    expect(stayJan.amount_cents).toBe(0); // 2 nights, Feb(1)+Mar(1) = fully covered
    expect(stayJan.billable_nights).toBe(0);
    expect(stayFeb.amount_cents).toBe(0);
    expect(stayFeb.billable_nights).toBe(0);

    // Now approve stayJan → consumes Feb(1) + Mar(1) monthly
    await simulateApprove(ALICE, stayJan.id, "ALICE01");
    expect(stayJan.status).toBe("APPROVED");
    expect(stayJan.billable_nights).toBe(0);
    expect(stayJan.amount_cents).toBe(0);

    // stayFeb refreshed: vehicle used, all monthly gone → 2 billable
    expect(stayFeb.billable_nights).toBe(2);
    expect(stayFeb.amount_cents).toBe(1000);
  });

  /* ================================================================
     EDGE CASE: Multi-resident interaction — one resident's actions
     don't affect another's passes
     ================================================================ */

  it("residents have fully independent pass pools", async () => {
    // Alice uses all her passes
    const aliceStay = createStay(ALICE, "ALICE01", "2026-01-05", "2026-01-10");
    await simulateApprove(ALICE, aliceStay.id, "ALICE01");

    // Carol should still have full passes
    const carolStay = createStay(CAROL, "CAROL01", "2026-01-10", "2026-01-12");
    const carolB = await simulateApprove(CAROL, carolStay.id, "CAROL01");
    expect(carolB.guestFreePassApplied).toBe(1);
    expect(carolB.freeNightsApplied).toBe(1);
    expect(carolB.billableNights).toBe(0);

    // Dave also independent
    const daveStay = createStay(DAVE, "DAVE01", "2026-01-15", "2026-01-16");
    const daveB = await simulateApprove(DAVE, daveStay.id, "DAVE01");
    expect(daveB.freeNightsApplied).toBe(1);
    expect(daveB.billableNights).toBe(0);
  });

  /* ================================================================
     EDGE CASE: Rapid cron fire — running cron twice for same month
     should not double-add passes
     ================================================================ */

  it("duplicate cron for same month does NOT double-add passes", async () => {
    // Run cron for Feb twice
    simulateMonthlyCron("2026-02-01");
    simulateMonthlyCron("2026-02-01");

    const aliceBuckets = passBuckets.filter((b) => b.resident_id === ALICE);
    expect(aliceBuckets).toHaveLength(2); // Jan + Feb (not Jan + Feb + Feb)

    // And the Feb bucket has total=1, not 2
    const feb = aliceBuckets.find((b) => b.month_start === "2026-02-01");
    expect(feb!.free_nights_total).toBe(1);
  });

  /* ================================================================
     EDGE CASE: Year boundary — stay crossing Dec → Jan
     ================================================================ */

  it("stay crossing year boundary (Dec 2025 → Jan 2026)", async () => {
    // Give Alice a Dec 2025 bucket
    passBuckets.push({
      resident_id: ALICE,
      month_start: "2025-12-01",
      free_nights_total: 1,
      free_nights_used: 0,
    });

    // Stay: Dec 29 → Jan 3 (5 nights: 3 Dec + 2 Jan)
    const yearStay = createStay(ALICE, "ALICE01", "2025-12-29", "2026-01-03");
    const billing = await simulateApprove(ALICE, yearStay.id, "ALICE01");

    expect(billing.totalNights).toBe(5);
    expect(billing.guestFreePassApplied).toBe(1);
    expect(billing.freeNightsApplied).toBe(2); // Dec(1) + Jan(1)
    expect(billing.billableNights).toBe(2);
    expect(billing.months).toHaveLength(2);
    expect(billing.months[0].monthStart).toBe("2025-12-01");
    expect(billing.months[0].nights).toBe(3);
    expect(billing.months[1].monthStart).toBe("2026-01-01");
    expect(billing.months[1].nights).toBe(2);
  });

  /* ================================================================
     EDGE CASE: Heavy accumulation — 6 months no usage then big stay
     ================================================================ */

  it("6 months of accumulated passes used in one large stay", async () => {
    // Run cron for all 6 months without Carol using anything
    simulateMonthlyCron("2026-02-01");
    simulateMonthlyCron("2026-03-01");
    simulateMonthlyCron("2026-04-01");
    simulateMonthlyCron("2026-05-01");
    simulateMonthlyCron("2026-06-01");

    // Carol has 6 monthly passes + vehicle pass = 7 free nights
    const carolBuckets = passBuckets.filter(
      (b) => b.resident_id === CAROL && b.free_nights_used < b.free_nights_total
    );
    expect(carolBuckets).toHaveLength(6);

    // Carol books 10-night stay
    const carolStay = createStay(CAROL, "CAROL01", "2026-06-10", "2026-06-20");
    const billing = await simulateApprove(CAROL, carolStay.id, "CAROL01");

    expect(billing.totalNights).toBe(10);
    expect(billing.guestFreePassApplied).toBe(1);
    expect(billing.freeNightsApplied).toBe(6); // all 6 monthly passes
    expect(billing.billableNights).toBe(3); // 10 - 1 - 6
    expect(billing.amountCents).toBe(1500);

    // All Carol's buckets consumed (oldest first)
    for (const month of ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01"]) {
      expect(
        passBuckets.find((b) => b.resident_id === CAROL && b.month_start === month)!.free_nights_used
      ).toBe(1);
    }
  });
});
