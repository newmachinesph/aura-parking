import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

/**
 * Verify JWT with full signature check using jose.
 * Returns the decoded payload or null if invalid/expired.
 */
async function verifyToken(
  token: string
): Promise<{ sub: number; email: string; role: string; residentId: number | null } | null> {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return null;
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret)
    );
    if (!payload.role) return null;
    return payload as unknown as { sub: number; email: string; role: string; residentId: number | null };
  } catch {
    return null;
  }
}

const DASHBOARD_BY_ROLE: Record<string, string> = {
  admin: "/admin/dashboard",
  staff: "/staff/dashboard",
  resident: "/dashboard",
};

// Public auth pages that should redirect logged-in users to their dashboard
const PUBLIC_AUTH_PAGES = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/ops",
  "/resident",
  "/admin/login",
  "/admin/register",
  "/staff/login",
  "/staff/register",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("aura_token")?.value;
  const user = token ? await verifyToken(token) : null;

  // --- Public auth pages: redirect logged-in users to their dashboard ---
  if (PUBLIC_AUTH_PAGES.some((p) => pathname === p)) {
    if (user) {
      const dest = DASHBOARD_BY_ROLE[user.role] || "/dashboard";
      return NextResponse.redirect(new URL(dest, request.url));
    }
    return NextResponse.next();
  }

  // --- Protected app routes: require auth + correct role ---

  // Admin routes
  if (pathname.startsWith("/admin/")) {
    if (!user) return NextResponse.redirect(new URL("/ops", request.url));
    if (user.role !== "admin") {
      const dest = DASHBOARD_BY_ROLE[user.role] || "/dashboard";
      return NextResponse.redirect(new URL(dest, request.url));
    }
    return NextResponse.next();
  }

  // Staff routes
  if (pathname.startsWith("/staff/")) {
    if (!user) return NextResponse.redirect(new URL("/ops", request.url));
    if (user.role !== "staff") {
      const dest = DASHBOARD_BY_ROLE[user.role] || "/dashboard";
      return NextResponse.redirect(new URL(dest, request.url));
    }
    return NextResponse.next();
  }

  // Resident routes
  if (pathname.startsWith("/dashboard")) {
    if (!user) return NextResponse.redirect(new URL("/login", request.url));
    if (user.role === "admin") {
      return NextResponse.redirect(new URL("/admin/dashboard", request.url));
    }
    if (user.role === "staff") {
      return NextResponse.redirect(new URL("/staff/dashboard", request.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Landing + public auth pages (redirect-if-logged-in)
    "/",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/ops",
    "/resident",
    "/admin/login",
    "/admin/register",
    "/staff/login",
    "/staff/register",
    // Protected app routes
    "/dashboard/:path*",
    "/admin/:path*",
    "/staff/:path*",
  ],
};
