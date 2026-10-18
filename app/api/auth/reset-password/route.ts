import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { dbQuery } from "@/lib/db";
import { hashResetToken } from "@/lib/auth";
import { validatePassword, rateLimit } from "@/lib/validation";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { token, newPassword } = body;

    if (!token) {
      return NextResponse.json(
        { error: "token is required" },
        { status: 400 }
      );
    }

    // Rate limit: max 5 reset attempts per token per 15 min
    const rl = rateLimit(`reset-pw:${String(token).slice(0, 16)}`, 5, 15 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429 }
      );
    }

    const pwCheck = validatePassword(newPassword);
    if (!pwCheck.ok) {
      return NextResponse.json(
        { error: pwCheck.error },
        { status: 400 }
      );
    }

    const tokenHash = hashResetToken(token);

    const rows = await dbQuery(
      `SELECT r.id AS reset_id, r.user_id
       FROM auth_password_resets r
       WHERE r.reset_token_hash = :tokenHash
         AND r.used_at IS NULL
         AND r.expires_at > NOW()
       LIMIT 1`,
      { tokenHash }
    );

    const resetRow = rows?.[0];
    if (!resetRow) {
      return NextResponse.json(
        { error: "Invalid or expired reset token" },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(String(newPassword), 10);
    await dbQuery(
      `UPDATE auth_users
       SET password_hash = :passwordHash, updated_at = NOW()
       WHERE id = :userId`,
      { passwordHash, userId: resetRow.user_id }
    );

    // Mark this token used (and invalidate any other outstanding tokens for this user)
    await dbQuery(
      `UPDATE auth_password_resets
       SET used_at = NOW()
       WHERE user_id = :userId AND used_at IS NULL`,
      { userId: resetRow.user_id }
    );

    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to reset password" },
      { status: 500 }
    );
  }
}
