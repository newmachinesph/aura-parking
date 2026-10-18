import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { authRequired } from "@/lib/auth";

/**
 * GET /api/admin/counts
 * Returns total counts for residents, units, and guest stays (admin only).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = authRequired(request);
    if (auth instanceof NextResponse) return auth;
    if (auth.role !== "admin" && auth.role !== "staff") {
      return NextResponse.json({ error: "Admin or staff access required" }, { status: 403 });
    }

    const rows = await dbQuery(
      `SELECT
        CAST((SELECT COUNT(*) FROM residents) AS int) AS total_residents,
        CAST((SELECT COUNT(*) FROM units) AS int) AS total_units,
        CAST((SELECT COUNT(*) FROM guest_stays WHERE status NOT IN ('CANCELLED')) AS int) AS total_guests`
    );

    const counts = rows[0] || { total_residents: 0, total_units: 0, total_guests: 0 };
    return NextResponse.json(counts);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch counts" }, { status: 500 });
  }
}
