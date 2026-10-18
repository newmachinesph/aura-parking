import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { dbQuery } from "@/lib/db";
import { sendParkingEmail } from "@/lib/mailer";
import { validatePassword, rateLimit } from "@/lib/validation";

/**
 * POST /api/auth/register-admin
 * Public self-registration for admin/staff accounts.
 * Creates an INACTIVE account that requires admin approval.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { fullName, email, password, role } = body;

    if (!fullName || !email || !password) {
      return NextResponse.json(
        { error: "fullName, email, and password are required" },
        { status: 400 }
      );
    }

    // Validate role — only admin or staff allowed
    const validRoles = ["admin", "staff"];
    const cleanRole = String(role || "admin").toLowerCase();
    if (!validRoles.includes(cleanRole)) {
      return NextResponse.json(
        { error: "Role must be admin or staff" },
        { status: 400 }
      );
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const cleanName = String(fullName).trim();

    // Rate limit: max 5 registration attempts per email per 15 min
    const rl = rateLimit(`register:${normalizedEmail}`, 5, 15 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many registration attempts. Please try again later." },
        { status: 429 }
      );
    }

    // Global IP rate limit to prevent mass account creation from different emails
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const ipRl = rateLimit(`register-admin-ip:${ip}`, 3, 60 * 60 * 1000); // 3 per hour per IP
    if (!ipRl.ok) {
      return NextResponse.json(
        { error: "Too many registration attempts from this network. Please try again later." },
        { status: 429 }
      );
    }

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
       VALUES (NULL, :email, :passwordHash, :role, 'INACTIVE')
       RETURNING id`,
      { email: normalizedEmail, passwordHash, role: cleanRole }
    );

    await dbQuery(
      `INSERT INTO staff (auth_user_id, full_name, email, role)
       VALUES (:authUserId, :fullName, :email, :role)`,
      {
        authUserId: authInsert[0].id,
        fullName: cleanName,
        email: normalizedEmail,
        role: cleanRole,
      }
    );

    // Notify existing admin via email
    const adminEmail =
      process.env.ADMIN_NOTIFICATION_EMAIL || process.env.SUPPORT_INBOX_EMAIL;
    if (adminEmail && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      const dashboardUrl = `${process.env.FRONTEND_URL || ""}/admin/users`;
      try {
        await sendParkingEmail(
          adminEmail,
          `New ${cleanRole.charAt(0).toUpperCase() + cleanRole.slice(1)} Registration Pending Approval`,
          "staff_registration_admin_notify",
          {
            staff_name: cleanName,
            staff_email: normalizedEmail,
            staff_role: cleanRole,
            dashboard_url: dashboardUrl,
          }
        );
      } catch (emailErr: unknown) {
        const e = emailErr as { message?: string };
        console.error(
          "[register-admin] Failed to send admin notification:",
          e?.message
        );
      }
    }

    return NextResponse.json({ status: "ok" }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to register" },
      { status: 500 }
    );
  }
}
