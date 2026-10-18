import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { dbQuery } from "@/lib/db";
import { normalizeEmail, signToken, setAuthCookie } from "@/lib/auth";
import { rateLimit } from "@/lib/validation";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "email and password are required" },
        { status: 400 }
      );
    }

    // Rate limit: max 5 login attempts per email per 15 min
    const rl = rateLimit(`login:${normalizeEmail(email)}`, 5, 15 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        { status: 429 }
      );
    }

    const rows = await dbQuery(
      `SELECT au.id, au.resident_id, au.email, au.password_hash, au.role, au.status,
              COALESCE(r.full_name, s.full_name) AS full_name,
              u.unit_number
       FROM auth_users au
       LEFT JOIN residents r ON r.id = au.resident_id
       LEFT JOIN units u ON u.id = r.unit_id
       LEFT JOIN staff s ON s.auth_user_id = au.id
       WHERE au.email = :email
       LIMIT 1`,
      { email: normalizeEmail(email) }
    );

    const user = rows?.[0];
    if (!user) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    const ok = await bcrypt.compare(String(password), String(user.password_hash));
    if (!ok) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    if (user.status !== "ACTIVE") {
      const msg = "Your account is pending approval. An admin has been notified and will review your request from the admin portal.";
      return NextResponse.json({ error: msg }, { status: 403 });
    }

    const residentId = user.resident_id ? Number(user.resident_id) : null;

    const token = signToken({
      sub: Number(user.id),
      email: user.email,
      role: user.role,
      residentId,
    });

    const response = NextResponse.json({
      user: {
        id: Number(user.id),
        email: user.email,
        role: user.role,
        residentId,
        fullName: user.full_name || user.email.split("@")[0],
        unitNumber: user.unit_number || null,
      },
    });

    setAuthCookie(response, token);
    return response;
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json(
      { error: "Login failed" },
      { status: 500 }
    );
  }
}
