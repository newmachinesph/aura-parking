import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { authRequired } from "@/lib/auth";
import { sendParkingEmail } from "@/lib/mailer";
import { monthStartISO } from "@/lib/helpers";

/* ------------------------------------------------------------------ */
/*  POST /api/cron/monthly-reset                                      */
/*  Upserts monthly free pass buckets for all active residents and    */
/*  sends notification emails.  Designed to be called by an external  */
/*  cron trigger (e.g. Vercel Cron, AWS EventBridge).                 */
/* ------------------------------------------------------------------ */
export async function POST(request: NextRequest) {
  try {
    // Verify via CRON_SECRET header OR admin JWT
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get("authorization");
    const cronOk = cronSecret && authHeader === `Bearer ${cronSecret}`;

    if (!cronOk) {
      const auth = authRequired(request);
      if (auth instanceof NextResponse) return auth;
      if (auth.role !== "admin") {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 });
      }
    }

    const monthStart = monthStartISO(new Date());

    // Add a new monthly free pass for all active residents (accumulated, not reset)
    await dbQuery(
      `INSERT INTO resident_free_pass_months (resident_id, month_start, free_nights_total, free_nights_used)
       SELECT r.id, :monthStart, 1, 0
       FROM residents r
       WHERE r.status = 'ACTIVE'
       ON CONFLICT (resident_id, month_start) DO NOTHING`,
      { monthStart },
    );

    // Guest vehicle free passes are one-time only (not reset monthly).
    // Once a plate has used its free pass, it never receives another.

    const residents = await dbQuery(
      `SELECT r.email, u.unit_number
       FROM residents r
       INNER JOIN units u ON u.id = r.unit_id
       WHERE r.status = 'ACTIVE' AND r.email IS NOT NULL AND r.email <> ''`,
      {},
    );

    const actionUrl =
      process.env.MONTHLY_PASSES_URL || process.env.FRONTEND_URL || "";

    // Send emails in batches to avoid SMTP throttling
    let emailsSent = 0;
    const BATCH_SIZE = 5;
    for (let i = 0; i < residents.length; i += BATCH_SIZE) {
      const batch = residents.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((row: { email: string; unit_number: string }) =>
          sendParkingEmail(
            row.email,
            "New Monthly Guest Pass Added",
            "monthly_pass_refill",
            { unit_number: row.unit_number, action_url: actionUrl },
          )
        )
      );
      emailsSent += results.filter((r) => r.status === "fulfilled" && (r.value as { ok: boolean }).ok).length;
    }

    return NextResponse.json({
      status: "ok",
      monthStart,
      residentsNotified: emailsSent,
    });
  } catch (err: unknown) {
    // If DB isn't configured, return a soft failure
    if ((err as { code?: string })?.code === "DB_NOT_CONFIGURED") {
      console.log("[cron] monthly pass reset skipped (db not configured)");
      return NextResponse.json(
        { status: "skipped", reason: "db not configured" },
        { status: 200 },
      );
    }

    console.error("[cron] monthly pass reset failed", err);
    return NextResponse.json(
      { error: "Monthly reset failed" },
      { status: 500 },
    );
  }
}
