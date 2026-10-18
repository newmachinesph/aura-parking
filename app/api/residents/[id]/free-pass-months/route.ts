import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { authRequired } from "@/lib/auth";
/**
 * GET /api/residents/:id/free-pass-months
 * Returns accumulated free_nights_total, free_nights_used, and free_nights_remaining
 * across ALL months (passes accumulate, not reset monthly).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authRequired(request);
    if (auth instanceof NextResponse) return auth;

    const { id } = await params;
    const residentId = Number(id);
    if (!residentId) {
      return NextResponse.json(
        { error: "Invalid resident id" },
        { status: 400 }
      );
    }

    // Residents can only view their own pass balance
    if (auth.role === "resident" && auth.residentId !== residentId) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    const residentRows = await dbQuery(
      `SELECT r.id, r.full_name, r.email, u.unit_number
       FROM residents r
       INNER JOIN units u ON u.id = r.unit_id
       WHERE r.id = :residentId LIMIT 1`,
      { residentId }
    );

    if (!residentRows?.length) {
      return NextResponse.json(
        { error: "Resident not found" },
        { status: 404 }
      );
    }

    // Sum ALL months' passes (accumulated across months)
    const rows = await dbQuery(
      `SELECT COALESCE(SUM(free_nights_total), 0) AS total_allocated,
              COALESCE(SUM(free_nights_used), 0) AS total_used
       FROM resident_free_pass_months
       WHERE resident_id = :residentId`,
      { residentId }
    );

    const freeTotal = Number(rows?.[0]?.total_allocated ?? 1);
    const freeUsed = Number(rows?.[0]?.total_used ?? 0);

    return NextResponse.json({
      residentId,
      unitNumber: residentRows[0].unit_number,
      freeNightsTotal: freeTotal,
      freeNightsUsed: freeUsed,
      freeNightsRemaining: Math.max(0, freeTotal - freeUsed),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch free pass usage" },
      { status: 500 }
    );
  }
}
