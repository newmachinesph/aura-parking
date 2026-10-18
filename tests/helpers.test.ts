import { describe, it, expect } from "vitest";
import { splitNightsByMonth } from "@/lib/billing";
import { normalizePlate, toSqlDate, monthStartISO, normalizeUnitNumber, formatShortDate } from "@/lib/helpers";

/* ================================================================
   Helper / utility function tests
   ================================================================ */

describe("normalizePlate", () => {
  it("uppercases and strips spaces/dashes", () => {
    expect(normalizePlate("abc-1234")).toBe("ABC1234");
    expect(normalizePlate(" Ab c 12 ")).toBe("ABC12");
    expect(normalizePlate("XY--Z")).toBe("XYZ");
  });

  it("handles empty / whitespace", () => {
    expect(normalizePlate("")).toBe("");
    expect(normalizePlate("  ")).toBe("");
  });

  it("handles plates with multiple dashes and spaces", () => {
    expect(normalizePlate("CA-7-XYZ-123")).toBe("CA7XYZ123");
    expect(normalizePlate("  AZ 00 01  ")).toBe("AZ0001");
  });

  it("preserves digits and letters only", () => {
    expect(normalizePlate("ABC1234")).toBe("ABC1234");
  });
});

describe("toSqlDate", () => {
  it("converts ISO string to YYYY-MM-DD", () => {
    expect(toSqlDate("2026-03-15T12:00:00Z")).toBe("2026-03-15");
  });

  it("converts Date object", () => {
    const d = new Date(Date.UTC(2026, 0, 5)); // Jan 5
    expect(toSqlDate(d)).toBe("2026-01-05");
  });

  it("handles ISO string with time and timezone", () => {
    expect(toSqlDate("2026-12-31T23:59:59.999Z")).toBe("2026-12-31");
  });

  it("handles date at start of year", () => {
    expect(toSqlDate("2026-01-01T00:00:00Z")).toBe("2026-01-01");
  });
});

describe("monthStartISO", () => {
  it("returns first of month in YYYY-MM-DD", () => {
    const d = new Date(Date.UTC(2026, 4, 17)); // May 17
    expect(monthStartISO(d)).toBe("2026-05-01");
  });

  it("handles Jan correctly", () => {
    const d = new Date(Date.UTC(2026, 0, 31)); // Jan 31
    expect(monthStartISO(d)).toBe("2026-01-01");
  });

  it("handles Dec correctly", () => {
    const d = new Date(Date.UTC(2026, 11, 25)); // Dec 25
    expect(monthStartISO(d)).toBe("2026-12-01");
  });

  it("returns current month when no arg given", () => {
    const result = monthStartISO();
    expect(result).toMatch(/^\d{4}-\d{2}-01$/);
  });
});

describe("normalizeUnitNumber", () => {
  it("strips 'Unit' prefix with dash", () => {
    expect(normalizeUnitNumber("Unit - A-101")).toBe("A-101");
  });

  it("strips 'unit' prefix case-insensitive", () => {
    expect(normalizeUnitNumber("UNIT - B-202")).toBe("B-202");
    expect(normalizeUnitNumber("unit-C-301")).toBe("C-301");
  });

  it("returns trimmed value when no prefix", () => {
    expect(normalizeUnitNumber("  A-101  ")).toBe("A-101");
  });

  it("returns null for null/undefined", () => {
    expect(normalizeUnitNumber(null)).toBeNull();
    expect(normalizeUnitNumber(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeUnitNumber("")).toBeNull();
    expect(normalizeUnitNumber("  ")).toBeNull();
  });

  it("passes through non-prefixed values", () => {
    expect(normalizeUnitNumber("301")).toBe("301");
    expect(normalizeUnitNumber("B-102")).toBe("B-102");
  });
});

describe("formatShortDate", () => {
  it("formats date string to short format", () => {
    const result = formatShortDate("2026-03-15");
    expect(result).toBe("Mar 15");
  });

  it("formats Date object", () => {
    const d = new Date(Date.UTC(2026, 0, 5)); // Jan 5
    const result = formatShortDate(d);
    expect(result).toBe("Jan 5");
  });

  it("handles Dec 31", () => {
    expect(formatShortDate("2026-12-31")).toBe("Dec 31");
  });
});

/* ================================================================
   splitNightsByMonth — pure function, no DB dependency
   ================================================================ */

describe("splitNightsByMonth", () => {
  it("single month, simple stay", () => {
    const parts = splitNightsByMonth("2026-02-10", "2026-02-14");
    expect(parts).toEqual([{ monthStart: "2026-02-01", nights: 4 }]);
  });

  it("1-night stay", () => {
    const parts = splitNightsByMonth("2026-03-01", "2026-03-02");
    expect(parts).toEqual([{ monthStart: "2026-03-01", nights: 1 }]);
  });

  it("crosses month boundary (Feb → Mar)", () => {
    const parts = splitNightsByMonth("2026-02-26", "2026-03-04");
    expect(parts).toEqual([
      { monthStart: "2026-02-01", nights: 3 }, // Feb 26,27,28 (2026 not leap)
      { monthStart: "2026-03-01", nights: 3 }, // Mar 1,2,3
    ]);
  });

  it("spans 3 months (Jan → Mar)", () => {
    const parts = splitNightsByMonth("2026-01-25", "2026-03-05");
    expect(parts).toEqual([
      { monthStart: "2026-01-01", nights: 7 },  // Jan 25-31
      { monthStart: "2026-02-01", nights: 28 }, // All Feb
      { monthStart: "2026-03-01", nights: 4 },  // Mar 1-4
    ]);
  });

  it("same-day stay counts as 1 night", () => {
    const parts = splitNightsByMonth("2026-03-05", "2026-03-05");
    expect(parts).toEqual([{ monthStart: "2026-03-01", nights: 1 }]);
  });

  it("end before start is invalid", () => {
    expect(() => splitNightsByMonth("2026-03-10", "2026-03-05")).toThrow(
      "endDate cannot be before startDate"
    );
  });

  it("full month (Feb 1 → Mar 1 = 28 nights)", () => {
    const parts = splitNightsByMonth("2026-02-01", "2026-03-01");
    expect(parts).toEqual([{ monthStart: "2026-02-01", nights: 28 }]);
  });

  it("year boundary (Dec → Jan)", () => {
    const parts = splitNightsByMonth("2025-12-29", "2026-01-03");
    expect(parts).toEqual([
      { monthStart: "2025-12-01", nights: 3 }, // Dec 29-31
      { monthStart: "2026-01-01", nights: 2 }, // Jan 1-2
    ]);
  });
});
