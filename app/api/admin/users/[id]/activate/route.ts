import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { authRequired } from "@/lib/auth";
import { sendParkingEmail } from "@/lib/mailer";
import { monthStartISO } from "@/lib/helpers";

/* ------------------------------------------------------------------ */
/*  POST /api/admin/users/:id/activate                                */
/*  Activates an INACTIVE staff/admin/resident account and sends email */
/* ------------------------------------------------------------------ */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = authRequired(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "admin") {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 },
    );
  }

  try {
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!id) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }

    const rows = await dbQuery(
      `SELECT au.id, au.email, au.role, au.status, au.resident_id,
              COALESCE(r.full_name, m.full_name) AS full_name,
              u.unit_number
       FROM auth_users au
       LEFT JOIN staff m ON m.auth_user_id = au.id
       LEFT JOIN residents r ON r.id = au.resident_id
       LEFT JOIN units u ON u.id = r.unit_id
       WHERE au.id = :id LIMIT 1`,
      { id },
    );

    if (!rows?.length) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const user = rows[0];
    if (user.status === "ACTIVE") {
      return NextResponse.json(
        { error: "User is already active" },
        { status: 409 },
      );
    }

    // Activate auth_users
    await dbQuery(
      `UPDATE auth_users SET status = 'ACTIVE', updated_at = NOW() WHERE id = :id`,
      { id },
    );

    const isResident = user.role === "resident";

    // For residents: also activate the resident record and create free pass bucket
    if (isResident && user.resident_id) {
      await dbQuery(
        `UPDATE residents SET status = 'ACTIVE', updated_at = NOW() WHERE id = :residentId`,
        { residentId: user.resident_id },
      );
      // Ensure free pass bucket exists
      await dbQuery(
        `INSERT INTO resident_free_pass_months (resident_id, month_start, free_nights_total, free_nights_used)
         VALUES (:residentId, :monthStart, 1, 0)
         ON CONFLICT (resident_id, month_start) DO UPDATE SET resident_id = EXCLUDED.resident_id`,
        { residentId: user.resident_id, monthStart: monthStartISO(new Date()) },
      );
    }

    // Send activation email
    const isAdmin = user.role === "admin";
    let loginUrl: string;
    let emailSubject: string;
    let templateName: string;
    let templateVars: Record<string, string>;

    if (isResident) {
      loginUrl = `${process.env.FRONTEND_URL || ""}/login`;
      emailSubject = "Your Resident Account Has Been Activated";
      templateName = "resident_account_activated";
      templateVars = { resident_name: user.full_name || user.email, login_url: loginUrl };
    } else {
      loginUrl = `${process.env.FRONTEND_URL || ""}/${isAdmin ? "ops" : "ops"}`;
      emailSubject = isAdmin
        ? "Your Admin Account Has Been Activated"
        : "Your Staff Account Has Been Activated";
      templateName = "staff_activation";
      templateVars = { staff_name: user.full_name || user.email, login_url: loginUrl };
    }

    let emailSent = false;
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      try {
        const emailResult = await sendParkingEmail(
          user.email,
          emailSubject,
          templateName,
          templateVars,
        );
        emailSent = !!emailResult?.ok;
        if (!emailSent) {
          console.error(
            "[activate-user] Email send returned failure:",
            emailResult?.error,
          );
        }
      } catch (emailErr: any) {
        console.error(
          "[activate-user] Failed to send activation email:",
          emailErr.message,
        );
      }
    } else {
      console.warn(
        "[activate-user] Skipped activation email: EMAIL_USER or EMAIL_PASS not configured",
      );
    }

    return NextResponse.json({ id, status: "ok", emailSent });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to activate user" },
      { status: 500 },
    );
  }
}
