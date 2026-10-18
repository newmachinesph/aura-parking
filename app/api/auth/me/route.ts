import { NextRequest, NextResponse } from "next/server";
import { authRequired } from "@/lib/auth";
import { dbQuery } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const auth = authRequired(request);
    if (auth instanceof NextResponse) return auth;

    // Look up the user's full name from residents or staff table
    const rows = await dbQuery(
      `SELECT COALESCE(r.full_name, s.full_name) AS full_name,
              u.unit_number
       FROM auth_users au
       LEFT JOIN residents r ON r.id = au.resident_id
       LEFT JOIN units u ON u.id = r.unit_id
       LEFT JOIN staff s ON s.auth_user_id = au.id
       WHERE au.id = :id
       LIMIT 1`,
      { id: auth.sub }
    );

    const fullName = rows?.[0]?.full_name || auth.email.split("@")[0];
    const unitNumber = rows?.[0]?.unit_number || null;

    return NextResponse.json({
      user: {
        id: auth.sub,
        email: auth.email,
        role: auth.role,
        residentId: auth.residentId || null,
        fullName,
        unitNumber,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch user info" },
      { status: 500 }
    );
  }
}
