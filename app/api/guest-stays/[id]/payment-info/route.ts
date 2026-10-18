import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

/**
 * GET /api/guest-stays/:id/payment-info
 * Returns basic stay info for the payment page.
 * Requires either a valid public_token OR authenticated access with ownership check.
 * Bare numeric ID without auth is rejected to prevent enumeration.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const token = request.nextUrl.searchParams.get("token");

    let rows;
    const id = Number(rawId);
    if (token) {
      // Public access with token — validates token matches the stay
      rows = await dbQuery(
        `SELECT gs.id, gs.status, gs.start_date, gs.end_date,
                COALESCE(gs.vehicle_plate, gs.plate_number) AS vehicle_plate,
                gs.vehicle_desc, gs.billable_nights, gs.amount_cents,
                u.unit_number, g.full_name AS guest_name
         FROM guest_stays gs
         INNER JOIN units u ON u.id = gs.unit_id
         INNER JOIN guests g ON g.id = gs.guest_id
         WHERE gs.id = :id AND gs.public_token = :token`,
        { id, token }
      );
    } else if (id) {
      // Authenticated access — require ownership verification (RD-SEC-01 fix)
      const auth = verifyAuth(request);
      if (!auth || auth === "expired") {
        return NextResponse.json({ error: "Authentication or token required" }, { status: 401 });
      }

      if (auth.role === "resident") {
        // Residents can only access stays for their own unit
        const resRows = await dbQuery(
          `SELECT unit_id FROM residents WHERE id = :residentId LIMIT 1`,
          { residentId: auth.residentId }
        );
        if (!resRows?.length) {
          return NextResponse.json({ error: "Resident not found" }, { status: 404 });
        }
        rows = await dbQuery(
          `SELECT gs.id, gs.status, gs.start_date, gs.end_date,
                  COALESCE(gs.vehicle_plate, gs.plate_number) AS vehicle_plate,
                  gs.vehicle_desc, gs.billable_nights, gs.amount_cents,
                  u.unit_number, g.full_name AS guest_name
           FROM guest_stays gs
           INNER JOIN units u ON u.id = gs.unit_id
           INNER JOIN guests g ON g.id = gs.guest_id
           WHERE gs.id = :id AND gs.unit_id = :unitId`,
          { id, unitId: resRows[0].unit_id }
        );
      } else {
        // Admin/staff can access any stay
        rows = await dbQuery(
          `SELECT gs.id, gs.status, gs.start_date, gs.end_date,
                  COALESCE(gs.vehicle_plate, gs.plate_number) AS vehicle_plate,
                  gs.vehicle_desc, gs.billable_nights, gs.amount_cents,
                  u.unit_number, g.full_name AS guest_name
           FROM guest_stays gs
           INNER JOIN units u ON u.id = gs.unit_id
           INNER JOIN guests g ON g.id = gs.guest_id
           WHERE gs.id = :id`,
          { id }
        );
      }
    } else {
      return NextResponse.json({ error: "Invalid stay id" }, { status: 400 });
    }

    if (!rows?.length) {
      return NextResponse.json({ error: "Stay not found" }, { status: 404 });
    }

    const stay = rows[0];
    if (stay.status !== "NEEDS_PAYMENT") {
      return NextResponse.json(
        { error: "This stay does not require payment" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      id: stay.id,
      guestName: stay.guest_name,
      unitNumber: stay.unit_number,
      vehiclePlate: stay.vehicle_plate,
      vehicleDesc: stay.vehicle_desc || "",
      startDate: stay.start_date,
      endDate: stay.end_date,
      billableNights: Number(stay.billable_nights),
      amountCents: Number(stay.amount_cents),
    });
  } catch (err) {
    console.error("[payment-info] GET error:", err);
    return NextResponse.json(
      { error: "Failed to load payment info" },
      { status: 500 }
    );
  }
}
