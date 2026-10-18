import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { dbQuery } from "@/lib/db";
import { authRequired } from "@/lib/auth";
import { sendParkingEmail } from "@/lib/mailer";
import { validatePassword } from "@/lib/validation";

export async function POST(request: NextRequest) {
  try {
    const auth = authRequired(request);
    if (auth instanceof NextResponse) return auth;
    if (auth.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { fullName, email, password } = body;

    if (!fullName || !email || !password) {
      return NextResponse.json(
        { error: "fullName, email, and password are required" },
        { status: 400 }
      );
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const cleanName = String(fullName).trim();
    const staffRole = "staff";

    const existing = await dbQuery(
      `SELECT id FROM auth_users WHERE email = :email LIMIT 1`,
      { email: normalizedEmail }
    );
    if (existing.length > 0) {
      return NextResponse.json(
        { error: "Email is already registered" },
        { status: 409 }
      );
    }

    const pwCheck = validatePassword(password);
    if (!pwCheck.ok) {
      return NextResponse.json({ error: pwCheck.error }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    const authInsert = await dbQuery(
      `INSERT INTO auth_users (resident_id, email, password_hash, role, status)
       VALUES (NULL, :email, :passwordHash, 'staff', 'INACTIVE')
       RETURNING id`,
      { email: normalizedEmail, passwordHash }
    );
    const authUserId = authInsert[0].id;

    await dbQuery(
      `INSERT INTO staff (auth_user_id, full_name, email, role)
       VALUES (:authUserId, :fullName, :email, :role)`,
      {
        authUserId,
        fullName: cleanName,
        email: normalizedEmail,
        role: staffRole,
      }
    );

    // Notify admin via email
    const adminEmail =
      process.env.ADMIN_NOTIFICATION_EMAIL || process.env.SUPPORT_INBOX_EMAIL;
    if (adminEmail && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      const dashboardUrl = `${process.env.FRONTEND_URL || ""}/admin/dashboard`;
      try {
        await sendParkingEmail(
          adminEmail,
          "New Staff Registration Request",
          "staff_registration_admin_notify",
          {
            staff_name: cleanName,
            staff_email: normalizedEmail,
            staff_role: staffRole,
            dashboard_url: dashboardUrl,
          }
        );
      } catch (emailErr: unknown) {
        const e = emailErr as { message?: string };
        console.error(
          "[register-staff] Failed to send admin notification:",
          e?.message
        );
      }
    }

    return NextResponse.json({ status: "ok" }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to register staff" },
      { status: 500 }
    );
  }
}
