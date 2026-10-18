import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { authRequired } from "@/lib/auth";
import { parsePaginationParams, paginatedResult } from "@/lib/pagination";
import { todayMST } from "@/lib/helpers";

/* ------------------------------------------------------------------ */
/*  GET /api/unauthorized-vehicles  –  List unauthorized vehicles     */
/* ------------------------------------------------------------------ */
export async function GET(request: NextRequest) {
  const auth = authRequired(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "admin" && auth.role !== "staff") {
    return NextResponse.json({ error: "Admin or staff access required" }, { status: 403 });
  }

  try {
    const sp = request.nextUrl.searchParams;
    const { cursor, limit } = parsePaginationParams(sp);
    const fetchLimit = limit + 1;
    const cursorClause = cursor ? "WHERE id < :cursor" : "";

    const rows = await dbQuery(
      `SELECT id, plate_number, vehicle_make, vehicle_color, violation_note,
              image_url, spotted_date, spotted_location,
              recommended_action, resolved, reported_by,
              created_at, updated_at
       FROM unauthorized_vehicles
       ${cursorClause}
       ORDER BY id DESC
       LIMIT :fetchLimit`,
      { ...(cursor ? { cursor } : {}), fetchLimit },
    );

    const { items, hasMore, nextCursor } = paginatedResult(rows as (typeof rows[0] & { id: number })[], limit);
    return NextResponse.json({ vehicles: items, hasMore, nextCursor });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to list unauthorized vehicles" },
      { status: 500 },
    );
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/unauthorized-vehicles  –  Create record                 */
/*  Accepts JSON or FormData (image_url as string for now)            */
/* ------------------------------------------------------------------ */
export async function POST(request: NextRequest) {
  const auth = authRequired(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "admin" && auth.role !== "staff") {
    return NextResponse.json({ error: "Admin or staff access required" }, { status: 403 });
  }

  try {
    let plate_number: string | null = null;
    let vehicle_make: string | null = null;
    let vehicle_color: string | null = null;
    let violation_note: string | null = null;
    let spotted_date: string | null = null;
    let spotted_location: string | null = null;
    let recommended_action = "warn";
    let image_url: string | null = null;

    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      plate_number = formData.get("plate_number") as string | null;
      vehicle_make = formData.get("vehicle_make") as string | null;
      vehicle_color = formData.get("vehicle_color") as string | null;
      violation_note = formData.get("violation_note") as string | null;
      spotted_date = formData.get("spotted_date") as string | null;
      spotted_location = formData.get("spotted_location") as string | null;
      recommended_action =
        (formData.get("recommended_action") as string) || "warn";
      image_url = formData.get("image_url") as string | null;
    } else {
      const body = await request.json();
      plate_number = body.plate_number ?? null;
      vehicle_make = body.vehicle_make ?? null;
      vehicle_color = body.vehicle_color ?? null;
      violation_note = body.violation_note ?? null;
      spotted_date = body.spotted_date ?? null;
      spotted_location = body.spotted_location ?? null;
      recommended_action = body.recommended_action || "warn";
      image_url = body.image_url ?? null;
    }

    if (!plate_number) {
      return NextResponse.json(
        { error: "plate_number is required" },
        { status: 400 },
      );
    }

    // Validate recommended_action against allowed values
    const ALLOWED_ACTIONS = ["warn", "sticker", "tow", "monitor"];
    if (!ALLOWED_ACTIONS.includes(recommended_action)) {
      return NextResponse.json(
        { error: `recommended_action must be one of: ${ALLOWED_ACTIONS.join(", ")}` },
        { status: 400 },
      );
    }

    const result = await dbQuery(
      `INSERT INTO unauthorized_vehicles
          (plate_number, vehicle_make, vehicle_color, violation_note, image_url,
           spotted_date, spotted_location, recommended_action)
       VALUES
          (:plate_number, :vehicle_make, :vehicle_color, :violation_note, :image_url,
           :spotted_date, :spotted_location, :recommended_action)
       RETURNING id`,
      {
        plate_number: String(plate_number).trim().toUpperCase(),
        vehicle_make: vehicle_make || null,
        vehicle_color: vehicle_color || null,
        violation_note: violation_note || null,
        image_url: image_url || null,
        spotted_date: spotted_date || todayMST(),
        spotted_location: spotted_location || null,
        recommended_action,
      },
    );

    const insertedId = result[0]?.id ?? result.insertId;

    return NextResponse.json(
      { id: insertedId, image_url, status: "ok" },
      { status: 201 },
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to add unauthorized vehicle" },
      { status: 500 },
    );
  }
}
