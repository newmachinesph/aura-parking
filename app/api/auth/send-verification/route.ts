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

    // Rate limit: max 3 SMS per phone per 10 min
    const rl = rateLimit(`sms:${phone}`, 3, 10 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many verification attempts. Please try again later." },
        { status: 429 }
      );
    }

    // Check if phone number is already taken
    const existingPhone = await dbQuery(
      `SELECT id FROM residents WHERE phone = :phone LIMIT 1`,
      { phone: String(phone).trim() }
    );

    if (existingPhone.length > 0) {
      return NextResponse.json(
        { error: "Phone number is already registered to another account" },
        { status: 409 }
      );
    }

    // Test mode: skip real SMS
    if (isTwilioTestMode()) {
      console.log(`[TWILIO TEST] Verification sent to ${phone} — use code 123456`);
      return NextResponse.json({ success: true, status: "pending" });
    }

    const verification = await (twilioClient as any).verify.v2
      .services(getVerifyServiceSid())
      .verifications.create({ to: phone, channel: "sms" });

    return NextResponse.json({ success: true, status: verification.status });
  } catch (err: unknown) {
    console.error("Twilio send error:", err);
    return NextResponse.json(
      { error: "Failed to send verification code" },
      { status: 500 }
    );
  }
}
