import { NextRequest, NextResponse } from "next/server";
import { authRequired } from "@/lib/auth";
import { sendParkingEmail } from "@/lib/mailer";

/* ------------------------------------------------------------------ */
/*  POST /api/send-support-email  –  Send support email to admin      */
/* ------------------------------------------------------------------ */
export async function POST(request: NextRequest) {
  try {
    const auth = authRequired(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const { subject, message } = body || {};

    if (!subject || !message) {
      return NextResponse.json(
        { error: "Missing required fields: subject, message" },
        { status: 400 },
      );
    }

    const adminSupportInbox = process.env.SUPPORT_INBOX_EMAIL;

    if (
      !process.env.EMAIL_USER ||
      !process.env.EMAIL_PASS ||
      !adminSupportInbox
    ) {
      return NextResponse.json({
        message: "Support request received (email not configured)",
      });
    }

    const result = await sendParkingEmail(
      adminSupportInbox,
      `[Aura Apache Support] ${subject} - from ${auth.role}`,
      "support_request",
      {
        user_email: auth.email,
        role: auth.role,
        subject,
        message,
      },
      { replyTo: auth.email },
    );

    if (!result.ok) {
      console.error("[send-support-email] error:", result.error);
      return NextResponse.json(
        { error: "Failed to send email" },
        { status: 500 },
      );
    }

    return NextResponse.json({ message: "Email sent successfully" });
  } catch (err) {
    console.error("[send-support-email] POST error:", err);
    return NextResponse.json(
      { error: "Failed to send support email" },
      { status: 500 },
    );
  }
}
