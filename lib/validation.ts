/**
 * Validate password strength.
 * Requirements: 8+ chars, 1 uppercase, 1 lowercase, 1 digit, 1 special char.
 */
export function validatePassword(password: string): { ok: boolean; error?: string } {
  const pw = String(password || "");
  if (pw.length < 8) return { ok: false, error: "Password must be at least 8 characters" };
  if (!/[A-Z]/.test(pw)) return { ok: false, error: "Password must contain an uppercase letter" };
  if (!/[a-z]/.test(pw)) return { ok: false, error: "Password must contain a lowercase letter" };
  if (!/[0-9]/.test(pw)) return { ok: false, error: "Password must contain a digit" };
  if (!/[^A-Za-z0-9]/.test(pw)) return { ok: false, error: "Password must contain a special character" };
  return { ok: true };
}

/**
 * In-memory rate limiter.
 * Tracks requests per key (e.g. IP or email) within a sliding window.
 */
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function cleanupExpiredEntries() {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}

export function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { ok: boolean; retryAfterMs?: number } {
  // Bypass rate limiting in development/test mode
  if (process.env.NODE_ENV !== "production") {
    return { ok: true };
  }

  // Periodically clean up expired entries to prevent memory leak
  if (rateLimitStore.size > 1000) {
    cleanupExpiredEntries();
  }

  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  if (entry.count >= maxRequests) {
    return { ok: false, retryAfterMs: entry.resetAt - now };
  }

  entry.count++;
  return { ok: true };
}

/**
 * Validate date string is a reasonable date (not in the far future).
 */
export function isReasonableDate(dateStr: string): boolean {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const year = d.getFullYear();
  return year >= 2020 && year <= 2100;
}
