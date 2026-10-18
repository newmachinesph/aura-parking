import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { authRequired } from "@/lib/auth";

/**
 * GET /api/guest-vehicle-free-pass/:plate
 * Returns free pass status for a plate number.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ plate: string }> }
) {
  try {
    const auth = authRequired(request);
    if (auth instanceof NextResponse) return auth;

    const { plate: rawPlate } = await params;
    if (!rawPlate) {
      return NextResponse.json(
        { error: "plate is required" },
        { status: 400 }
      );
    }
    const plate = rawPlate.trim().toUpperCase().replace(/[\s-]/g, "");

    const rows = await dbQuery(
      `SELECT free_pass, used, guest_stay_id
       FROM guest_vehicle_free_pass
       WHERE plate_number = :plate
       LIMIT 1`,
      { plate }
    );

    if (!rows?.length) {
      // Plate not seen before -- will get a free pass on first request
      return NextResponse.json({
        plateNumber: plate,
        freePass: 1,
        used: false,
        guestStayId: null,
        isNewPlate: true,
      });
    }

    const row = rows[0];
    return NextResponse.json({
      plateNumber: plate,
      freePass: Number(row.free_pass),
      used: !!Number(row.used),
      guestStayId: row.guest_stay_id ? Number(row.guest_stay_id) : null,
      isNewPlate: false,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to check vehicle free pass" },
      { status: 500 }
    );
  }
}
