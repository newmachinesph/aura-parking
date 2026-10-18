import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { dbQuery } from "@/lib/db";
import { getTwilioClient, getVerifyServiceSid, isTwilioTestMode, TEST_MODE_CODE } from "@/lib/twilio";
import { validatePassword, rateLimit } from "@/lib/validation";
import { signToken, setAuthCookie } from "@/lib/auth";
import { monthStartISO } from "@/lib/helpers";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { unitNumber, fullName, email, password, phone, verificationCode } =
      body;

    if (!unitNumber || !fullName || !email || !password) {
      return NextResponse.json(
        { error: "unitNumber, fullName, email, password are required" },
        { status: 400 }
      );
    }

    if (!phone || !verificationCode) {
      return NextResponse.json(
        { error: "Phone number and verification code are required" },
        { status: 400 }
      );
    }

    // Password strength check
    const pwCheck = validatePassword(password);
    if (!pwCheck.ok) {
      return NextResponse.json({ error: pwCheck.error }, { status: 400 });
    }

    // Rate limit: max 5 registration attempts per phone per 15 min
    const rl = rateLimit(`register:${phone}`, 5, 15 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many registration attempts. Please try again later." },
        { status: 429 }
      );
    }

    // Verify the OTP code via Twilio
    if (isTwilioTestMode()) {
      if (String(verificationCode).trim() !== TEST_MODE_CODE) {
        return NextResponse.json(
          { error: "Invalid or expired verification code" },
          { status: 400 }
        );
      }
      console.log(`[TWILIO TEST] Registration code ${TEST_MODE_CODE} accepted for ${phone}`);
    } else {
      const twilioClient = getTwilioClient();
      if (!twilioClient) {
        console.error("[register-resident] Twilio client not configured — cannot verify OTP");
        return NextResponse.json(
          { error: "Phone verification is temporarily unavailable. Please try again later." },
          { status: 503 }
        );
      }
      const check = await (twilioClient as any).verify.v2
        .services(getVerifyServiceSid())
        .verificationChecks.create({ to: phone, code: verificationCode });

      if (check.status !== "approved") {
        return NextResponse.json(
          { error: "Invalid or expired verification code" },
          { status: 400 }
        );
      }
    }

    const cleanUnitNumber = String(unitNumber).trim();
    const normalizedEmail = String(email).trim().toLowerCase();

    // Check if email already exists
    const existingUser = await dbQuery(
      `SELECT id FROM auth_users WHERE email = :email LIMIT 1`,
      { email: normalizedEmail }
    );

    if (existingUser.length > 0) {
      return NextResponse.json(
        { error: "Email is already registered" },
        { status: 409 }
      );
    }

    // Check if phone number already exists
    const cleanPhone = String(phone).trim();
    const existingPhone = await dbQuery(
      `SELECT id FROM residents WHERE phone = :phone LIMIT 1`,
      { phone: cleanPhone }
    );

    if (existingPhone.length > 0) {
      return NextResponse.json(
        { error: "Phone number is already registered to another account" },
        { status: 409 }
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(String(password), 10);

    // Get or create unit — admin will verify during approval
    const unitRows = await dbQuery(
      `INSERT INTO units (unit_number)
       VALUES (:unitNumber)
       ON CONFLICT (unit_number) DO UPDATE SET unit_number = EXCLUDED.unit_number
       RETURNING id`,
      { unitNumber: cleanUnitNumber }
    );
    const unitId = (unitRows[0]?.id ?? unitRows.insertId) as number;

    const cleanName = String(fullName).trim();

    // Check if unit already has a primary contact — don't override
    const existingPrimary = await dbQuery(
      `SELECT id FROM residents WHERE unit_id = :unitId AND is_primary_contact = TRUE LIMIT 1`,
      { unitId }
    );
    const isPrimary = existingPrimary.length === 0;

    // Insert resident as ACTIVE (OTP already verified)
    const residentInsert = await dbQuery(
      `INSERT INTO residents (unit_id, full_name, email, phone, status, is_primary_contact)
       VALUES (:unitId, :fullName, :email, :phone, 'ACTIVE', :isPrimary)
       RETURNING id`,
      {
        unitId,
        fullName: cleanName,
        email: normalizedEmail,
        phone: cleanPhone,
        isPrimary,
      }
    );

    const residentId = residentInsert[0].id;

    // Insert auth user as ACTIVE
    const authInsert = await dbQuery(
      `INSERT INTO auth_users (resident_id, email, password_hash, role, status)
       VALUES (:residentId, :email, :passwordHash, 'resident', 'ACTIVE')
       RETURNING id`,
      {
        residentId,
        email: normalizedEmail,
        passwordHash,
      }
    );

    const authUserId = Number(authInsert[0].id);

    // Create free pass bucket for current month
    await dbQuery(
      `INSERT INTO resident_free_pass_months (resident_id, month_start, free_nights_total, free_nights_used)
       VALUES (:residentId, :monthStart, 1, 0)
       ON CONFLICT (resident_id, month_start) DO NOTHING`,
      { residentId, monthStart: monthStartISO(new Date()) }
    );

    // Auto-login: return auth token + user data
    const token = signToken({
      sub: authUserId,
      email: normalizedEmail,
      role: "resident",
      residentId: Number(residentId),
    });

    const response = NextResponse.json({
      status: "ok",
      user: {
        id: authUserId,
        email: normalizedEmail,
        role: "resident",
        residentId: Number(residentId),
        fullName: cleanName,
        unitNumber: cleanUnitNumber,
      },
    }, { status: 201 });

    setAuthCookie(response, token);
    return response;
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to register resident" },
      { status: 500 }
    );
  }
}
