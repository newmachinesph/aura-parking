export const DEFAULT_PAGE_SIZE = 50;

export function parsePaginationParams(sp: URLSearchParams) {
  const cursorRaw = sp.get("cursor");
  const limitRaw = sp.get("limit");
  const cursor = cursorRaw ? Math.max(0, parseInt(cursorRaw, 10)) || undefined : undefined;
  const limit = limitRaw
    ? Math.min(200, Math.max(1, parseInt(limitRaw, 10))) || DEFAULT_PAGE_SIZE
    : DEFAULT_PAGE_SIZE;
  return { cursor, limit };
}

export function paginatedResult<T extends { id: number }>(
  rows: T[],
  limit: number,
): { items: T[]; hasMore: boolean; nextCursor: number | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null;
  return { items, hasMore, nextCursor };
}
