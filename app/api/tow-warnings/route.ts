import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { authRequired } from "@/lib/auth";
import { sendParkingEmail } from "@/lib/mailer";

/* ------------------------------------------------------------------ */
/*  GET /api/tow-warnings                                              */
/*  List unauthorized vehicles with recommended_action = 'tow'.        */
/* ------------------------------------------------------------------ */
export async function GET(request: NextRequest) {
  try {
    const auth = authRequired(request);
    if (auth instanceof NextResponse) return auth;

    const rows = await dbQuery(
      `SELECT id, plate_number, vehicle_make, vehicle_color,
              violation_note, image_url, spotted_date, spotted_location,
              recommended_action, resolved, reported_by,
              created_at, updated_at
       FROM unauthorized_vehicles
       WHERE recommended_action = 'tow' AND resolved = FALSE
       ORDER BY spotted_date DESC
       LIMIT 200`,
      {}
    );

    return NextResponse.json({ warnings: rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to list tow warnings" },
      { status: 500 }
    );
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/tow-warnings  –  Send tow warning email                 */
/* ------------------------------------------------------------------ */
export async function POST(request: NextRequest) {
  try {
    const auth = authRequired(request);
    if (auth instanceof NextResponse) return auth;
    if (auth.role !== "admin" && auth.role !== "staff") {
      return NextResponse.json(
        { error: "Admin or staff access required" },
        { status: 403 },
      );
    }

    const body = await request.json();
    const {
      toEmail,
      unitNumber = "",
      vehiclePlate,
      vehicleDesc = "",
      actionUrl,
    } = body || {};

    if (!toEmail || !vehiclePlate || !actionUrl) {
      return NextResponse.json(
        { error: "toEmail, vehiclePlate, actionUrl are required" },
        { status: 400 },
      );
    }

    const result = await sendParkingEmail(
      toEmail,
      "Final Warning: Unauthorized Vehicle",
      "tow_warning",
      {
        unit_number: unitNumber,
        vehicle_plate: vehiclePlate,
        vehicle_desc: vehicleDesc,
        action_url: actionUrl,
      },
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: "Failed to send tow warning" },
        { status: 500 },
      );
    }

    return NextResponse.json({ status: "sent" });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to send tow warning" },
      { status: 500 },
    );
  }
}
