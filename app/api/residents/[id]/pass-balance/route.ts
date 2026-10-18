import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { authRequired } from "@/lib/auth";
import { FREE_NIGHTS_PER_RESIDENT_PER_MONTH } from "@/lib/billing";

/**
 * GET /api/residents/:id/pass-balance
 * Returns the resident's bonus passes and monthly free night status.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authRequired(request);
    if (auth instanceof NextResponse) return auth;

    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!id) {
      return NextResponse.json({ error: "Invalid resident id" }, { status: 400 });
    }

    // Residents can only view their own balance; admin/staff can view any
    if (auth.role === "resident" && Number(auth.residentId) !== id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get bonus passes
    const residentRows = await dbQuery(
      `SELECT bonus_free_nights FROM residents WHERE id = :id LIMIT 1`,
      { id }
    );
    if (!residentRows.length) {
      return NextResponse.json({ error: "Resident not found" }, { status: 404 });
    }
    const bonusPasses = Number((residentRows[0] as Record<string, unknown>).bonus_free_nights ?? 0);

    // Sum ALL months' free night passes (accumulated across months)
    const monthRows = await dbQuery(
      `SELECT COALESCE(SUM(free_nights_total), 0) AS total_allocated,
              COALESCE(SUM(free_nights_used), 0) AS total_used
       FROM resident_free_pass_months
       WHERE resident_id = :id`,
      { id }
    );

    const monthlyFreeTotal = Number((monthRows[0] as Record<string, unknown>)?.total_allocated ?? FREE_NIGHTS_PER_RESIDENT_PER_MONTH);
    const monthlyFreeUsed = Number((monthRows[0] as Record<string, unknown>)?.total_used ?? 0);

    return NextResponse.json({
      bonusPasses,
      monthlyFreeTotal,
      monthlyFreeUsed,
      monthlyFreeRemaining: Math.max(0, monthlyFreeTotal - monthlyFreeUsed),
    });
  } catch (error: unknown) {
    console.error(error);
    return NextResponse.json(
      { error: "Failed to get pass balance" },
      { status: 500 }
    );
  }
}
