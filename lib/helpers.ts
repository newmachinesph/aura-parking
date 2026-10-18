export function formatShortDate(dateStr: string | Date): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function monthStartISO(date?: Date): string {
  const d = date || new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

/**
 * Convert a date to YYYY-MM-DD for database storage.
 * Date-only strings ("2026-02-23") are returned as-is since they represent
 * calendar dates and should NOT be shifted through timezone conversion.
 * Date objects and datetime strings are converted to MST for consistency
 * with todayMST().
 */
export function toSqlDate(value: string | Date): string {
  if (typeof value === "string") {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  const d = new Date(value);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Denver" });
}

/** Returns today's date as YYYY-MM-DD in America/Denver (MST/MDT) */
export function todayMST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
}

export function normalizePlate(plate: string): string {
  return String(plate).trim().toUpperCase().replace(/[\s-]/g, "");
}

export function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export function generatePublicToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function normalizeUnitNumber(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return raw
    .replace(/^\s*Unit\s*[-\s]+/i, "")
    .trim();
}
