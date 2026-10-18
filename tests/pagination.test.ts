import { describe, it, expect } from "vitest";
import { parsePaginationParams, paginatedResult, DEFAULT_PAGE_SIZE } from "@/lib/pagination";

/* ================================================================
   PAGINATION HELPER TESTS
   ================================================================ */

describe("DEFAULT_PAGE_SIZE", () => {
  it("is 50", () => {
    expect(DEFAULT_PAGE_SIZE).toBe(50);
  });
});

describe("parsePaginationParams", () => {
  it("returns defaults when no params provided", () => {
    const sp = new URLSearchParams();
    const result = parsePaginationParams(sp);
    expect(result.cursor).toBeUndefined();
    expect(result.limit).toBe(50);
  });

  it("parses cursor and limit from query params", () => {
    const sp = new URLSearchParams("cursor=100&limit=25");
    const result = parsePaginationParams(sp);
    expect(result.cursor).toBe(100);
    expect(result.limit).toBe(25);
  });

  it("clamps limit to max 200", () => {
    const sp = new URLSearchParams("limit=500");
    expect(parsePaginationParams(sp).limit).toBe(200);
  });

  it("clamps limit=0 to 1", () => {
    const sp = new URLSearchParams("limit=0");
    expect(parsePaginationParams(sp).limit).toBe(1);
  });

  it("clamps negative limit to 1", () => {
    const sp = new URLSearchParams("limit=-10");
    expect(parsePaginationParams(sp).limit).toBe(1);
  });

  it("ignores invalid cursor (NaN)", () => {
    const sp = new URLSearchParams("cursor=abc");
    expect(parsePaginationParams(sp).cursor).toBeUndefined();
  });

  it("ignores negative cursor (clamped to 0, then undefined)", () => {
    const sp = new URLSearchParams("cursor=-5");
    expect(parsePaginationParams(sp).cursor).toBeUndefined();
  });

  it("handles cursor=0 as undefined", () => {
    const sp = new URLSearchParams("cursor=0");
    expect(parsePaginationParams(sp).cursor).toBeUndefined();
  });

  it("parses valid limit without cursor", () => {
    const sp = new URLSearchParams("limit=10");
    const result = parsePaginationParams(sp);
    expect(result.cursor).toBeUndefined();
    expect(result.limit).toBe(10);
  });

  it("parses valid cursor without limit", () => {
    const sp = new URLSearchParams("cursor=42");
    const result = parsePaginationParams(sp);
    expect(result.cursor).toBe(42);
    expect(result.limit).toBe(50);
  });
});

describe("paginatedResult", () => {
  it("returns all items when rows <= limit (no more pages)", () => {
    const rows = [{ id: 3 }, { id: 2 }, { id: 1 }];
    const result = paginatedResult(rows, 5);
    expect(result.items).toEqual([{ id: 3 }, { id: 2 }, { id: 1 }]);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("trims +1 row and sets hasMore when rows > limit", () => {
    const rows = [{ id: 5 }, { id: 4 }, { id: 3 }, { id: 2 }, { id: 1 }];
    const result = paginatedResult(rows, 4);
    expect(result.items).toHaveLength(4);
    expect(result.items).toEqual([{ id: 5 }, { id: 4 }, { id: 3 }, { id: 2 }]);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe(2); // last item's id
  });

  it("handles empty array", () => {
    const result = paginatedResult([], 50);
    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("handles exactly limit items (no hasMore)", () => {
    const rows = [{ id: 3 }, { id: 2 }, { id: 1 }];
    const result = paginatedResult(rows, 3);
    expect(result.items).toHaveLength(3);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("handles exactly limit+1 items (hasMore = true)", () => {
    const rows = [{ id: 4 }, { id: 3 }, { id: 2 }, { id: 1 }];
    const result = paginatedResult(rows, 3);
    expect(result.items).toHaveLength(3);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe(2);
  });

  it("preserves item properties beyond id", () => {
    const rows = [
      { id: 10, name: "Alice", email: "a@b.com" },
      { id: 9, name: "Bob", email: "b@b.com" },
    ];
    const result = paginatedResult(rows, 5);
    expect(result.items[0]).toEqual({ id: 10, name: "Alice", email: "a@b.com" });
  });

  it("single item, limit=1 → no hasMore", () => {
    const result = paginatedResult([{ id: 1 }], 1);
    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("two items, limit=1 → hasMore, cursor = first item id", () => {
    const result = paginatedResult([{ id: 5 }, { id: 4 }], 1);
    expect(result.items).toEqual([{ id: 5 }]);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe(5);
  });
});
