import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { authRequired } from "@/lib/auth";
import { parsePaginationParams, paginatedResult } from "@/lib/pagination";

/**
 * GET /api/residents/:id/guest-stays
 * Fetch guest_stays for a resident based on their unit_id.
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

    // Residents can only view their own stays
    if (auth.role === "resident" && auth.residentId !== residentId) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    const residentRows = await dbQuery(
      `SELECT r.id, r.unit_id
       FROM residents r
       WHERE r.id = :residentId
       LIMIT 1`,
      { residentId }
    );

    if (!residentRows?.length) {
      return NextResponse.json(
        { error: "Resident not found" },
        { status: 404 }
      );
    }

    const unitId = residentRows[0].unit_id;
    const sp = request.nextUrl.searchParams;
    const { cursor, limit } = parsePaginationParams(sp);

    const fetchLimit = limit + 1;
    const cursorClause = cursor ? "AND gs.id < :cursor" : "";

    const rows = await dbQuery(
      `SELECT gs.id, gs.unit_id, gs.start_date, gs.end_date,
              COALESCE(gs.vehicle_plate, gs.plate_number) AS vehicle_plate,
              gs.vehicle_desc, gs.status,
              gs.passes_applied, gs.guest_free_pass_nights, gs.billable_nights, gs.amount_cents,
              u.unit_number,
              g.full_name AS guest_name,
              g.email AS guest_email
       FROM guest_stays gs
       INNER JOIN units u ON u.id = gs.unit_id
       INNER JOIN guests g ON g.id = gs.guest_id
       WHERE gs.unit_id = :unitId ${cursorClause}
       ORDER BY gs.id DESC
       LIMIT :fetchLimit`,
      { unitId, ...(cursor ? { cursor } : {}), fetchLimit }
    );

    const { items, hasMore, nextCursor } = paginatedResult(rows as (typeof rows[0] & { id: number })[], limit);
    return NextResponse.json({ residentId, unitId, stays: items, hasMore, nextCursor });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch resident guest stays" },
      { status: 500 }
    );
  }
}
