import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { getTwilioClient, getVerifyServiceSid, isTwilioTestMode } from "@/lib/twilio";
import { rateLimit } from "@/lib/validation";

export async function POST(request: NextRequest) {
  try {
    const twilioClient = getTwilioClient();
    if (!twilioClient) {
      return NextResponse.json(
        { error: "SMS service is not configured" },
        { status: 503 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { phone } = body;

    if (!phone) {
      return NextResponse.json(
        { error: "Phone number is required" },
        { status: 400 }
      );
    }

    // Rate limit: max 3 phone reset requests per phone per 10 min
    const rl = rateLimit(`forgot-pw-phone:${String(phone).trim()}`, 3, 10 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many reset attempts. Please try again later." },
        { status: 429 }
      );
    }

    // Look up resident by phone to confirm the number is on file
    const rows = await dbQuery(
      `SELECT r.id, r.phone, a.id AS auth_id, a.status
       FROM residents r
       JOIN auth_users a ON a.resident_id = r.id
       WHERE r.phone = :phone AND a.status = 'ACTIVE'
       LIMIT 1`,
      { phone: String(phone).trim() }
    );

    // Always return success to avoid account enumeration
    if (!rows.length) {
      return NextResponse.json({ success: true });
    }

    // Test mode: skip real SMS
    if (isTwilioTestMode()) {
      console.log(`[TWILIO TEST] Password reset code sent to ${phone} — use code 123456`);
      return NextResponse.json({ success: true });
    }

    await (twilioClient as any).verify.v2
      .services(getVerifyServiceSid())
      .verifications.create({ to: String(phone).trim(), channel: "sms" });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Phone reset send error:", err);
    return NextResponse.json(
      { error: "Failed to send verification code" },
      { status: 500 }
    );
  }
}
