import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { dbQuery } from "@/lib/db";
import { authRequired } from "@/lib/auth";
import { validatePassword } from "@/lib/validation";

export async function POST(request: NextRequest) {
  const auth = authRequired(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "Current and new passwords are required" },
        { status: 400 }
      );
    }

    const pwCheck = validatePassword(newPassword);
    if (!pwCheck.ok) {
      return NextResponse.json({ error: pwCheck.error }, { status: 400 });
    }

    // Fetch current hash
    const rows = await dbQuery(
      `SELECT password_hash FROM auth_users WHERE id = :userId LIMIT 1`,
      { userId: auth.sub }
    );

    const user = rows?.[0];
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Verify current password
    const valid = await bcrypt.compare(String(currentPassword), user.password_hash);
    if (!valid) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 400 }
      );
    }

    // Hash and save new password
    const newHash = await bcrypt.hash(String(newPassword), 10);
    await dbQuery(
      `UPDATE auth_users SET password_hash = :newHash, updated_at = NOW() WHERE id = :userId`,
      { newHash, userId: auth.sub }
    );

    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to change password" },
      { status: 500 }
    );
  }
}
