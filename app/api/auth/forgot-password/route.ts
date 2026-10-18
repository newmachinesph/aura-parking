import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { dbQuery } from "@/lib/db";
import { normalizeEmail, hashResetToken } from "@/lib/auth";
import { sendParkingEmail } from "@/lib/mailer";
import { rateLimit } from "@/lib/validation";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { email } = body;
    const normalized = normalizeEmail(email);

    if (!normalized) {
      return NextResponse.json(
        { error: "email is required" },
        { status: 400 }
      );
    }

    // Rate limit: max 3 reset requests per email per 15 min
    const rl = rateLimit(`forgot-pw:${normalized}`, 3, 15 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many reset attempts. Please try again later." },
        { status: 429 }
      );
    }

    if (!process.env.FRONTEND_URL) {
      return NextResponse.json(
        { error: "FRONTEND_URL is not configured on the server" },
        { status: 500 }
      );
    }

    // Require an auth user exists to reset a password (works for any role)
    const authRows = await dbQuery(
      `SELECT id, email, role, status FROM auth_users WHERE email = :email LIMIT 1`,
      { email: normalized }
    );

    const authUser = authRows?.[0];

    // Always respond 200 to avoid account enumeration
    if (!authUser || authUser.status !== "ACTIVE") {
      return NextResponse.json({ status: "ok" });
    }

    // Determine login page based on role for the reset email link
    const returnToMap: Record<string, string> = {
      admin: "/admin/login",
      staff: "/staff/login",
    };
    const returnTo = returnToMap[authUser.role as string] || "/login";

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashResetToken(token);

    // 1 hour expiry
    const ip =
      String(
        request.headers.get("x-forwarded-for") || ""
      ).slice(0, 64) || null;
    const ua =
      String(request.headers.get("user-agent") || "").slice(0, 255) || null;

    await dbQuery(
      `INSERT INTO auth_password_resets (user_id, reset_token_hash, expires_at, ip, user_agent)
       VALUES (:userId, :tokenHash, NOW() + INTERVAL '1 hour', :ip, :ua)`,
      {
        userId: authUser.id,
        tokenHash,
        ip,
        ua,
      }
    );

    const emailResult = await sendParkingEmail(
      normalized,
      "Password Reset",
      "password-reset",
      {
        token,
        frontend_url: String(process.env.FRONTEND_URL),
        return_to: returnTo,
      }
    );

    if (!emailResult?.ok) {
      console.error("[forgot-password] email send failed", emailResult?.error);
      // Still return ok to avoid leaking state
      return NextResponse.json({ status: "ok" });
    }

    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to process password reset request" },
      { status: 500 }
    );
  }
}
