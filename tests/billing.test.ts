import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BillingResult } from "@/lib/billing";

/* ================================================================
   Mock the DB layer so billing tests run without a real database.
   We intercept dbQuery calls and return controlled data.
   ================================================================ */

// Track all DB queries for assertions
let dbCalls: { sql: string; params: Record<string, unknown> }[] = [];

// Configurable mock data per test
let mockVehiclePass: { free_pass: number; used: boolean } | null = null;
let mockBonusNights = 0;
let mockMonthlyBuckets: { month_start: string; free_nights_total: number; free_nights_used: number }[] = [];

vi.mock("@/lib/db", () => ({
  dbQuery: vi.fn(async (sql: string, params: Record<string, unknown> = {}) => {
    dbCalls.push({ sql: sql.trim(), params });

    // Vehicle free pass lookup
    if (sql.includes("guest_vehicle_free_pass")) {
      if (sql.includes("SELECT")) {
        const rows = mockVehiclePass ? [mockVehiclePass] : [];
        return Object.assign(rows, { insertId: null, rowCount: rows.length });
      }
      return Object.assign([], { insertId: null, rowCount: 0 });
    }

    // Resident bonus nights lookup
    if (sql.includes("bonus_free_nights") && sql.includes("SELECT")) {
      const rows = [{ bonus_free_nights: mockBonusNights }];
      return Object.assign(rows, { insertId: null, rowCount: 1 });
    }

    // Monthly bucket listing (for pool)
    if (sql.includes("resident_free_pass_months") && sql.includes("SELECT") && sql.includes("ORDER BY")) {
      const available = mockMonthlyBuckets.filter(
        (b) => b.free_nights_used < b.free_nights_total
      );
      return Object.assign(available, { insertId: null, rowCount: available.length });
    }

    // ensureMonthlyBucket INSERT (no-op for tests)
    if (sql.includes("INSERT INTO resident_free_pass_months")) {
      return Object.assign([], { insertId: null, rowCount: 0 });
    }

    // Pending stays lookup (for refreshPendingStayBilling)
    if (sql.includes("guest_stays") && sql.includes("PENDING")) {
      return Object.assign([], { insertId: null, rowCount: 0 });
    }

    // UPDATE guest_stays (for refreshPendingStayBilling)
    if (sql.includes("UPDATE guest_stays")) {
      return Object.assign([], { insertId: null, rowCount: 1 });
    }

    return Object.assign([], { insertId: null, rowCount: 0 });
  }),
  getDbPool: vi.fn(),
  dbTransaction: vi.fn(),
}));

// Import AFTER mocks are set up
const { calculateStayBilling, splitNightsByMonth, refreshPendingStayBilling } = await import("@/lib/billing");

beforeEach(() => {
  dbCalls = [];
  mockVehiclePass = null;
  mockBonusNights = 0;
  mockMonthlyBuckets = [];
  vi.clearAllMocks();
});

/* ================================================================
   BILLING ENGINE TESTS
   ================================================================ */

describe("calculateStayBilling", () => {
  const RES = 1; // residentId

  /* ---------- TC-01: 1-night stay, new plate (vehicle free pass only) ---------- */
  it("TC-01: 1-night stay with vehicle free pass → $0, no monthly pass touched", async () => {
    mockVehiclePass = { free_pass: 1, used: false };
    mockBonusNights = 0;
    mockMonthlyBuckets = [{ month_start: "2026-02-01", free_nights_total: 1, free_nights_used: 0 }];

    const result = await calculateStayBilling(RES, "2026-02-20", "2026-02-21", {
      plateNumber: "NEW001",
    });

    expect(result.totalNights).toBe(1);
    expect(result.guestFreePassApplied).toBe(1);
    expect(result.bonusNightsApplied).toBe(0);
    expect(result.freeNightsApplied).toBe(0);
    expect(result.billableNights).toBe(0);
    expect(result.amountCents).toBe(0);
    // Monthly pass should NOT be consumed
    expect(result.monthConsumptions).toEqual([]);
  });

  /* ---------- TC-02: 1-night stay, used plate → monthly pass consumed ---------- */
  it("TC-02: 1-night stay, plate already used → uses monthly pass", async () => {
    mockVehiclePass = { free_pass: 1, used: true };
    mockBonusNights = 0;
    mockMonthlyBuckets = [{ month_start: "2026-02-01", free_nights_total: 1, free_nights_used: 0 }];

    const result = await calculateStayBilling(RES, "2026-02-20", "2026-02-21", {
      plateNumber: "USED001",
    });

    expect(result.totalNights).toBe(1);
    expect(result.guestFreePassApplied).toBe(0);
    expect(result.freeNightsApplied).toBe(1);
    expect(result.billableNights).toBe(0);
    expect(result.amountCents).toBe(0);
    expect(result.monthConsumptions).toEqual([
      { monthStart: "2026-02-01", consumed: 1 },
    ]);
  });

  /* ---------- TC-03: 3-night stay, new plate + 1 monthly pass → 1 billable ---------- */
  it("TC-03: 3-night stay, vehicle free + 1 monthly → 1 billable", async () => {
    mockVehiclePass = { free_pass: 1, used: false };
    mockBonusNights = 0;
    mockMonthlyBuckets = [{ month_start: "2026-02-01", free_nights_total: 1, free_nights_used: 0 }];

    const result = await calculateStayBilling(RES, "2026-02-20", "2026-02-23", {
      plateNumber: "NEW002",
    });

    expect(result.totalNights).toBe(3);
    expect(result.guestFreePassApplied).toBe(1);
    expect(result.freeNightsApplied).toBe(1);
    expect(result.billableNights).toBe(1);
    expect(result.amountCents).toBe(500); // 1 × $5
  });

  /* ---------- TC-04: No passes at all → fully billable ---------- */
  it("TC-04: 3-night stay, no passes → 3 billable", async () => {
    mockVehiclePass = { free_pass: 1, used: true };
    mockBonusNights = 0;
    mockMonthlyBuckets = []; // no monthly buckets

    const result = await calculateStayBilling(RES, "2026-02-20", "2026-02-23", {
      plateNumber: "USED002",
    });

    expect(result.totalNights).toBe(3);
    expect(result.guestFreePassApplied).toBe(0);
    expect(result.bonusNightsApplied).toBe(0);
    expect(result.freeNightsApplied).toBe(0);
    expect(result.billableNights).toBe(3);
    expect(result.amountCents).toBe(1500);
  });

  /* ---------- TC-05: Bonus passes applied before monthly ---------- */
  it("TC-05: 5-night stay, 2 bonus + 1 monthly → 2 billable", async () => {
    mockVehiclePass = { free_pass: 1, used: true };
    mockBonusNights = 2;
    mockMonthlyBuckets = [{ month_start: "2026-02-01", free_nights_total: 1, free_nights_used: 0 }];

    const result = await calculateStayBilling(RES, "2026-02-10", "2026-02-15", {
      plateNumber: "USED003",
    });

    expect(result.totalNights).toBe(5);
    expect(result.guestFreePassApplied).toBe(0);
    expect(result.bonusNightsApplied).toBe(2);
    expect(result.freeNightsApplied).toBe(1);
    expect(result.billableNights).toBe(2);
    expect(result.amountCents).toBe(1000);
  });

  /* ---------- TC-06: Vehicle free + bonus + monthly (all 3 types) ---------- */
  it("TC-06: 6-night stay, vehicle free + 2 bonus + 1 monthly → 2 billable", async () => {
    mockVehiclePass = { free_pass: 1, used: false };
    mockBonusNights = 2;
    mockMonthlyBuckets = [{ month_start: "2026-02-01", free_nights_total: 1, free_nights_used: 0 }];

    const result = await calculateStayBilling(RES, "2026-02-10", "2026-02-16", {
      plateNumber: "NEW003",
    });

    expect(result.totalNights).toBe(6);
    expect(result.guestFreePassApplied).toBe(1);
    expect(result.bonusNightsApplied).toBe(2);
    expect(result.freeNightsApplied).toBe(1);
    expect(result.billableNights).toBe(2);
    expect(result.amountCents).toBe(1000);
  });

  /* ---------- TC-07: Accumulated monthly passes (3 months) ---------- */
  it("TC-07: 4-night stay, 3 accumulated monthly passes → 1 billable (oldest consumed first)", async () => {
    mockVehiclePass = { free_pass: 1, used: true };
    mockBonusNights = 0;
    mockMonthlyBuckets = [
      { month_start: "2025-12-01", free_nights_total: 1, free_nights_used: 0 },
      { month_start: "2026-01-01", free_nights_total: 1, free_nights_used: 0 },
      { month_start: "2026-02-01", free_nights_total: 1, free_nights_used: 0 },
    ];

    const result = await calculateStayBilling(RES, "2026-02-10", "2026-02-14", {
      plateNumber: "USED004",
    });

    expect(result.totalNights).toBe(4);
    expect(result.freeNightsApplied).toBe(3);
    expect(result.billableNights).toBe(1);
    expect(result.amountCents).toBe(500);
    // Oldest months consumed first
    expect(result.monthConsumptions).toEqual([
      { monthStart: "2025-12-01", consumed: 1 },
      { monthStart: "2026-01-01", consumed: 1 },
      { monthStart: "2026-02-01", consumed: 1 },
    ]);
  });

  /* ---------- TC-08: Cross-month stay ---------- */
  it("TC-08: stay crossing Feb → Mar, with 1 monthly pass", async () => {
    mockVehiclePass = { free_pass: 1, used: true };
    mockBonusNights = 0;
    mockMonthlyBuckets = [{ month_start: "2026-02-01", free_nights_total: 1, free_nights_used: 0 }];

    const result = await calculateStayBilling(RES, "2026-02-26", "2026-03-04", {
      plateNumber: "USED005",
    });

    expect(result.totalNights).toBe(6); // 3 in Feb + 3 in Mar (2026 not leap)
    expect(result.freeNightsApplied).toBe(1);
    expect(result.billableNights).toBe(5);
    expect(result.amountCents).toBe(2500);
    // Month breakdown
    expect(result.months).toHaveLength(2);
    expect(result.months[0].monthStart).toBe("2026-02-01");
    expect(result.months[0].nights).toBe(3);
    expect(result.months[1].monthStart).toBe("2026-03-01");
    expect(result.months[1].nights).toBe(3);
  });

  /* ---------- TC-09: No plate at all (no vehicle free pass check) ---------- */
  it("TC-09: stay without plate number → no vehicle pass check", async () => {
    mockVehiclePass = { free_pass: 1, used: false }; // exists but should not be checked
    mockBonusNights = 0;
    mockMonthlyBuckets = [];

    const result = await calculateStayBilling(RES, "2026-02-10", "2026-02-12");

    expect(result.totalNights).toBe(2);
    expect(result.guestFreePassApplied).toBe(0); // no plate → no vehicle check
    expect(result.billableNights).toBe(2);
    expect(result.amountCents).toBe(1000);
  });

  /* ---------- TC-10: All passes exceed stay length ---------- */
  it("TC-10: 2-night stay with 5 accumulated passes → 0 billable (no over-consumption)", async () => {
    mockVehiclePass = { free_pass: 1, used: true };
    mockBonusNights = 0;
    mockMonthlyBuckets = [
      { month_start: "2025-10-01", free_nights_total: 1, free_nights_used: 0 },
      { month_start: "2025-11-01", free_nights_total: 1, free_nights_used: 0 },
      { month_start: "2025-12-01", free_nights_total: 1, free_nights_used: 0 },
      { month_start: "2026-01-01", free_nights_total: 1, free_nights_used: 0 },
      { month_start: "2026-02-01", free_nights_total: 1, free_nights_used: 0 },
    ];

    const result = await calculateStayBilling(RES, "2026-02-10", "2026-02-12", {
      plateNumber: "USED006",
    });

    expect(result.totalNights).toBe(2);
    expect(result.freeNightsApplied).toBe(2);
    expect(result.billableNights).toBe(0);
    expect(result.amountCents).toBe(0);
    // Only 2 of the 5 passes consumed (oldest first)
    expect(result.monthConsumptions).toEqual([
      { monthStart: "2025-10-01", consumed: 1 },
      { monthStart: "2025-11-01", consumed: 1 },
    ]);
  });

  /* ---------- TC-11: Partially used monthly buckets ---------- */
  it("TC-11: buckets with some already used → only remaining consumed", async () => {
    mockVehiclePass = null;
    mockBonusNights = 0;
    // Bucket with total=2, used=1 → 1 remaining
    mockMonthlyBuckets = [
      { month_start: "2026-02-01", free_nights_total: 2, free_nights_used: 1 },
    ];

    const result = await calculateStayBilling(RES, "2026-02-10", "2026-02-13");

    expect(result.totalNights).toBe(3);
    expect(result.freeNightsApplied).toBe(1);
    expect(result.billableNights).toBe(2);
    expect(result.amountCents).toBe(1000);
  });

  /* ---------- TC-12: Custom rate ---------- */
  it("TC-12: custom rate per night", async () => {
    mockVehiclePass = null;
    mockBonusNights = 0;
    mockMonthlyBuckets = [];

    const result = await calculateStayBilling(RES, "2026-02-10", "2026-02-12", {
      rateCentsPerNight: 1000,
    });

    expect(result.totalNights).toBe(2);
    expect(result.rateCentsPerNight).toBe(1000);
    expect(result.billableNights).toBe(2);
    expect(result.amountCents).toBe(2000);
  });

  /* ---------- TC-13: Invalid rate ---------- */
  it("TC-13: negative rate throws", async () => {
    await expect(
      calculateStayBilling(RES, "2026-02-10", "2026-02-12", { rateCentsPerNight: -100 })
    ).rejects.toThrow("Invalid rateCentsPerNight");
  });

  /* ---------- TC-14: Bonus exceeds remaining after vehicle pass ---------- */
  it("TC-14: bonus passes alone cover entire stay", async () => {
    mockVehiclePass = { free_pass: 1, used: false };
    mockBonusNights = 10;
    mockMonthlyBuckets = [{ month_start: "2026-02-01", free_nights_total: 1, free_nights_used: 0 }];

    const result = await calculateStayBilling(RES, "2026-02-10", "2026-02-14", {
      plateNumber: "NEW004",
    });

    expect(result.totalNights).toBe(4);
    expect(result.guestFreePassApplied).toBe(1);
    expect(result.bonusNightsApplied).toBe(3); // capped at remaining after vehicle pass
    expect(result.freeNightsApplied).toBe(0); // no need for monthly
    expect(result.billableNights).toBe(0);
    expect(result.amountCents).toBe(0);
    expect(result.monthConsumptions).toEqual([]);
  });
});
