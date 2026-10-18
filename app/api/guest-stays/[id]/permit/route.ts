import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

/**
 * GET /api/guest-stays/:id/permit
 * Returns permit info for the digital permit page.
 * Requires either a valid public_token OR authenticated access.
 * Bare numeric ID without auth is rejected to prevent enumeration.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const token = request.nextUrl.searchParams.get("token");

    const id = Number(rawId);
    if (!id) {
      return NextResponse.json({ error: "Invalid stay id" }, { status: 400 });
    }

    let rows;
    if (token) {
      // Token-based access (for email links)
      rows = await dbQuery(
        `SELECT gs.id, gs.status, gs.start_date, gs.end_date,
                COALESCE(gs.vehicle_plate, gs.plate_number) AS vehicle_plate,
                gs.vehicle_desc, gs.billable_nights, gs.amount_cents,
                gs.passes_applied, gs.guest_free_pass_nights,
                u.unit_number, g.full_name AS guest_name, g.email AS guest_email
         FROM guest_stays gs
         INNER JOIN units u ON u.id = gs.unit_id
         INNER JOIN guests g ON g.id = gs.guest_id
         WHERE gs.id = :id AND gs.public_token = :token`,
        { id, token }
      );
    } else {
      // Require authentication for bare ID access (prevents enumeration)
      const auth = verifyAuth(request);
      if (!auth || auth === "expired") {
        return NextResponse.json({ error: "Authentication or token required" }, { status: 401 });
      }
      rows = await dbQuery(
        `SELECT gs.id, gs.status, gs.start_date, gs.end_date,
                COALESCE(gs.vehicle_plate, gs.plate_number) AS vehicle_plate,
                gs.vehicle_desc, gs.billable_nights, gs.amount_cents,
                gs.passes_applied, gs.guest_free_pass_nights,
                u.unit_number, g.full_name AS guest_name, g.email AS guest_email
         FROM guest_stays gs
         INNER JOIN units u ON u.id = gs.unit_id
         INNER JOIN guests g ON g.id = gs.guest_id
         WHERE gs.id = :id`,
        { id }
      );
    }

    if (!rows?.length) {
      return NextResponse.json({ error: "Permit not found" }, { status: 404 });
    }

    const stay = rows[0];

    // Only show permit for approved/paid stays
    const validStatuses = ["APPROVED", "PAID", "NEEDS_PAYMENT"];
    if (!validStatuses.includes(String(stay.status))) {
      return NextResponse.json(
        { error: "Permit not available for this stay" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      id: stay.id,
      status: stay.status,
      guestName: stay.guest_name,
      unitNumber: stay.unit_number,
      vehiclePlate: stay.vehicle_plate,
      vehicleDesc: stay.vehicle_desc || "",
      startDate: stay.start_date,
      endDate: stay.end_date,
      billableNights: Number(stay.billable_nights),
      amountCents: Number(stay.amount_cents),
      passesApplied: Number(stay.passes_applied || 0),
    });
  } catch (err) {
    console.error("[permit] GET error:", err);
    return NextResponse.json(
      { error: "Failed to load permit info" },
      { status: 500 }
    );
  }
}
