import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { authRequired } from "@/lib/auth";

/* ------------------------------------------------------------------ */
/*  PATCH /api/unauthorized-vehicles/:id  –  Update vehicle details   */
/* ------------------------------------------------------------------ */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = authRequired(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "admin" && auth.role !== "staff") {
    return NextResponse.json({ error: "Admin or staff access required" }, { status: 403 });
  }

  try {
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!id) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await request.json();
    const { plateNumber, vehicleMake, vehicleColor, violationNote, spottedLocation, recommendedAction } = body || {};

    const updates: string[] = [];
    const values: Record<string, unknown> = { id };

    if (plateNumber != null) { updates.push("plate_number = :plateNumber"); values.plateNumber = String(plateNumber).trim().toUpperCase().replace(/[\s-]/g, ""); }
    if (vehicleMake != null) { updates.push("vehicle_make = :vehicleMake"); values.vehicleMake = String(vehicleMake).trim(); }
    if (vehicleColor != null) { updates.push("vehicle_color = :vehicleColor"); values.vehicleColor = String(vehicleColor).trim(); }
    if (violationNote != null) { updates.push("violation_note = :violationNote"); values.violationNote = String(violationNote).trim(); }
    if (spottedLocation != null) { updates.push("spotted_location = :spottedLocation"); values.spottedLocation = String(spottedLocation).trim(); }
    if (recommendedAction != null) {
      const ALLOWED_ACTIONS = ["warn", "sticker", "tow", "monitor"];
      const cleanAction = String(recommendedAction).trim();
      if (!ALLOWED_ACTIONS.includes(cleanAction)) {
        return NextResponse.json({ error: `recommended_action must be one of: ${ALLOWED_ACTIONS.join(", ")}` }, { status: 400 });
      }
      updates.push("recommended_action = :recommendedAction"); values.recommendedAction = cleanAction;
    }

    if (updates.length > 0) {
      await dbQuery(`UPDATE unauthorized_vehicles SET ${updates.join(", ")} WHERE id = :id`, values);
    }

    return NextResponse.json({ id, status: "ok" });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update vehicle" }, { status: 500 });
  }
}

/* ------------------------------------------------------------------ */
/*  DELETE /api/unauthorized-vehicles/:id  –  Delete record           */
/* ------------------------------------------------------------------ */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = authRequired(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "admin" && auth.role !== "staff") {
    return NextResponse.json(
      { error: "Admin or staff access required" },
      { status: 403 },
    );
  }

  try {
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!id) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    await dbQuery(`DELETE FROM unauthorized_vehicles WHERE id = :id`, { id });

    return NextResponse.json({ id, status: "deleted" });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to delete unauthorized vehicle" },
      { status: 500 },
    );
  }
}
