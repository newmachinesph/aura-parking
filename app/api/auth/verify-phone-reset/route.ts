import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { dbQuery } from "@/lib/db";
import { hashResetToken } from "@/lib/auth";
import { getTwilioClient, getVerifyServiceSid, isTwilioTestMode, TEST_MODE_CODE } from "@/lib/twilio";
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
    const { phone, code } = body;

    if (!phone || !code) {
      return NextResponse.json(
        { error: "Phone and code are required" },
        { status: 400 }
      );
    }

    // Rate limit: max 5 verify attempts per phone per 15 min
    const rl = rateLimit(`verify:${phone}`, 5, 15 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many verification attempts. Please try again later." },
        { status: 429 }
      );
    }

    // Test mode: accept the magic code
    if (isTwilioTestMode()) {
      if (String(code).trim() !== TEST_MODE_CODE) {
        return NextResponse.json(
          { error: "Invalid or expired verification code" },
          { status: 400 }
        );
      }
      console.log(`[TWILIO TEST] Code ${TEST_MODE_CODE} accepted for ${phone}`);
    } else {
      // Verify the OTP with Twilio
      const check = await (twilioClient as any).verify.v2
        .services(getVerifyServiceSid())
        .verificationChecks.create({
          to: String(phone).trim(),
          code: String(code).trim(),
        });

      if (check.status !== "approved") {
        return NextResponse.json(
          { error: "Invalid or expired verification code" },
          { status: 400 }
        );
      }
    }

    // Find the auth user by phone
    const rows = await dbQuery(
      `SELECT a.id AS auth_id
       FROM residents r
       JOIN auth_users a ON a.resident_id = r.id
       WHERE r.phone = :phone AND a.status = 'ACTIVE'
       LIMIT 1`,
      { phone: String(phone).trim() }
    );

    if (!rows.length) {
      return NextResponse.json(
        { error: "No account found for this phone number" },
        { status: 400 }
      );
    }

    // Generate a reset token (same mechanism as email flow)
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashResetToken(token);

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
        userId: rows[0].auth_id,
        tokenHash,
        ip,
        ua,
      }
    );

    return NextResponse.json({ success: true, token });
  } catch (err) {
    console.error("Phone reset verify error:", err);
    return NextResponse.json(
      { error: "Failed to verify code" },
      { status: 500 }
    );
  }
}
