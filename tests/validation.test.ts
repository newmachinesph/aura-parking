import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { validatePassword, rateLimit, isReasonableDate } from "@/lib/validation";

/* ================================================================
   PASSWORD VALIDATION TESTS
   ================================================================ */

describe("validatePassword", () => {
  it("rejects passwords shorter than 8 characters", () => {
    const result = validatePassword("Ab1!xyz");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("at least 8 characters");
  });

  it("rejects passwords without uppercase letter", () => {
    const result = validatePassword("abcdefg1!");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("uppercase letter");
  });

  it("rejects passwords without lowercase letter", () => {
    const result = validatePassword("ABCDEFG1!");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("lowercase letter");
  });

  it("rejects passwords without a digit", () => {
    const result = validatePassword("Abcdefgh!");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("digit");
  });

  it("rejects passwords without a special character", () => {
    const result = validatePassword("Abcdefg1");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("special character");
  });

  it("accepts a valid password", () => {
    expect(validatePassword("Str0ng!Pass")).toEqual({ ok: true });
  });

  it("accepts exactly 8-char password with all requirements", () => {
    expect(validatePassword("Ab1!xxxx")).toEqual({ ok: true });
  });

  it("handles empty string", () => {
    expect(validatePassword("").ok).toBe(false);
  });

  it("handles null/undefined coerced to string", () => {
    // The function does String(password || "")
    expect(validatePassword(null as unknown as string).ok).toBe(false);
    expect(validatePassword(undefined as unknown as string).ok).toBe(false);
  });

  it("validation checks are ordered (short → uppercase → lowercase → digit → special)", () => {
    // 1 char: fails on length first
    expect(validatePassword("a").error).toContain("8 characters");
    // 8 lowercase only: fails on uppercase
    expect(validatePassword("abcdefgh").error).toContain("uppercase");
    // 8 uppercase only: fails on lowercase
    expect(validatePassword("ABCDEFGH").error).toContain("lowercase");
    // mixed case no digit: fails on digit
    expect(validatePassword("ABCDefgh").error).toContain("digit");
    // mixed case + digit, no special: fails on special
    expect(validatePassword("ABCDefg1").error).toContain("special");
  });
});

/* ================================================================
   RATE LIMITER TESTS
   ================================================================ */

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests within limit", () => {
    const key = "test-allow";
    expect(rateLimit(key, 3, 60_000).ok).toBe(true); // 1
    expect(rateLimit(key, 3, 60_000).ok).toBe(true); // 2
    expect(rateLimit(key, 3, 60_000).ok).toBe(true); // 3
  });

  it("blocks requests beyond limit", () => {
    const key = "test-block";
    rateLimit(key, 2, 60_000); // 1
    rateLimit(key, 2, 60_000); // 2
    const result = rateLimit(key, 2, 60_000); // 3 → blocked
    expect(result.ok).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it("resets after window expires", () => {
    const key = "test-reset";
    rateLimit(key, 1, 10_000); // 1 → allowed
    const blocked = rateLimit(key, 1, 10_000); // 2 → blocked
    expect(blocked.ok).toBe(false);

    // Advance past the window
    vi.advanceTimersByTime(10_001);

    const afterReset = rateLimit(key, 1, 10_000);
    expect(afterReset.ok).toBe(true);
  });

  it("different keys are independent", () => {
    rateLimit("key-a", 1, 60_000); // use up key-a's limit
    rateLimit("key-a", 1, 60_000); // blocked
    expect(rateLimit("key-a", 1, 60_000).ok).toBe(false);
    // key-b is independent
    expect(rateLimit("key-b", 1, 60_000).ok).toBe(true);
  });

  it("returns retryAfterMs that decreases over time", () => {
    const key = "test-retry";
    rateLimit(key, 1, 30_000); // first request
    const blocked1 = rateLimit(key, 1, 30_000);
    expect(blocked1.ok).toBe(false);

    vi.advanceTimersByTime(10_000);

    const blocked2 = rateLimit(key, 1, 30_000);
    expect(blocked2.ok).toBe(false);
    expect(blocked2.retryAfterMs!).toBeLessThan(blocked1.retryAfterMs!);
  });

  it("handles limit of 0 (always blocks after first)", () => {
    // maxRequests=0 means the very first request hits the limit check:
    // First call sets count=1, which is > 0 on next call
    const key = "test-zero";
    // Actually, first call always returns ok (sets count=1)
    // because the entry doesn't exist yet
    expect(rateLimit(key, 0, 60_000).ok).toBe(true); // creates entry with count=1
    expect(rateLimit(key, 0, 60_000).ok).toBe(false); // count(1) >= max(0)
  });
});

/* ================================================================
   DATE VALIDATION TESTS
   ================================================================ */

describe("isReasonableDate", () => {
  it("accepts valid dates within range", () => {
    expect(isReasonableDate("2026-01-15")).toBe(true);
    expect(isReasonableDate("2025-06-01")).toBe(true);
    expect(isReasonableDate("2050-12-31")).toBe(true);
  });

  it("accepts boundary years (2020 and 2100)", () => {
    expect(isReasonableDate("2020-01-01")).toBe(true);
    expect(isReasonableDate("2100-12-31")).toBe(true);
  });

  it("rejects dates before 2020", () => {
    expect(isReasonableDate("2019-12-31")).toBe(false);
    expect(isReasonableDate("1999-01-01")).toBe(false);
  });

  it("rejects dates after 2100", () => {
    expect(isReasonableDate("2101-01-01")).toBe(false);
    expect(isReasonableDate("3000-06-15")).toBe(false);
  });

  it("rejects invalid date strings", () => {
    expect(isReasonableDate("not-a-date")).toBe(false);
    expect(isReasonableDate("")).toBe(false);
    expect(isReasonableDate("2026-13-01")).toBe(false); // month 13
  });

  it("accepts ISO 8601 datetime strings", () => {
    expect(isReasonableDate("2026-03-15T12:00:00Z")).toBe(true);
    expect(isReasonableDate("2026-03-15T00:00:00.000Z")).toBe(true);
  });

  it("accepts leap year Feb 29", () => {
    expect(isReasonableDate("2024-02-29")).toBe(true); // 2024 is a leap year
  });
});
