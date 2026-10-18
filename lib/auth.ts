import jwt from "jsonwebtoken";
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not configured");
  return secret;
}

interface AuthPayload {
  sub: number;
  email: string;
  role: string;
  residentId: number | null;
}

export function signToken(payload: AuthPayload): string {
  const isProd =
    String(process.env.NODE_ENV || "").toLowerCase() === "production";
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: isProd ? "7d" : "30d",
  });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, getJwtSecret()) as unknown as AuthPayload;
}

/**
 * Verify auth from request. Returns payload, null (no token), or "expired" string.
 * This allows callers to distinguish missing auth from expired sessions.
 */
export function verifyAuth(request: NextRequest): AuthPayload | null | "expired" {
  const cookieToken = request.cookies.get("aura_token")?.value;
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  // No token at all
  if (!cookieToken && !bearerToken) return null;

  // Try cookie first
  if (cookieToken) {
    try {
      return verifyToken(cookieToken);
    } catch {
      /* fall through to bearer */
    }
  }

  // Try Authorization header
  if (bearerToken) {
    try {
      return verifyToken(bearerToken);
    } catch {
      /* fall through */
    }
  }

  // Token was present but invalid/expired
  return "expired";
}

export function authRequired(
  request: NextRequest
): AuthPayload | NextResponse {
  const auth = verifyAuth(request);
  if (!auth || auth === "expired") {
    return NextResponse.json(
      { error: auth === "expired" ? "Session expired. Please log in again." : "Authentication required. Please log in." },
      { status: 401 }
    );
  }
  return auth;
}

export function setAuthCookie(response: NextResponse, token: string): void {
  const isProd =
    String(process.env.NODE_ENV || "").toLowerCase() === "production";
  response.cookies.set("aura_token", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: isProd ? 7 * 24 * 60 * 60 : 30 * 24 * 60 * 60,
  });
}

export function clearAuthCookie(response: NextResponse): void {
  response.cookies.set("aura_token", "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
}

export function normalizeEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

export function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
