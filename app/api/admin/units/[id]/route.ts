import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { authRequired } from "@/lib/auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authRequired(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!id) return NextResponse.json({ error: "Invalid unit id" }, { status: 400 });

    const body = await request.json();
    const { unitNumber, buildingCode } = body || {};

    const updates: string[] = [];
    const values: Record<string, unknown> = { id };

    if (unitNumber != null && String(unitNumber).trim()) {
      // Check for duplicate
      const dup = await dbQuery(
        `SELECT id FROM units WHERE unit_number = :unitNumber AND id != :id LIMIT 1`,
        { unitNumber: String(unitNumber).trim(), id }
      );
      if (dup.length > 0) {
        return NextResponse.json({ error: "Unit number already exists" }, { status: 409 });
      }
      updates.push("unit_number = :unitNumber");
      values.unitNumber = String(unitNumber).trim();
    }
    if (buildingCode !== undefined) {
      updates.push("building_code = :buildingCode");
      values.buildingCode = buildingCode ? String(buildingCode).trim() : null;
    }

    if (updates.length > 0) {
      await dbQuery(`UPDATE units SET ${updates.join(", ")} WHERE id = :id`, values);
    }

    return NextResponse.json({ id, status: "ok" });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update unit" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authRequired(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!id) return NextResponse.json({ error: "Invalid unit id" }, { status: 400 });

    // Check for residents linked to this unit
    const residents = await dbQuery(
      `SELECT COUNT(*) as count FROM residents WHERE unit_id = :id`,
      { id }
    );
    if (Number(residents[0]?.count) > 0) {
      return NextResponse.json(
        { error: "Cannot delete unit with residents. Remove residents first." },
        { status: 409 }
      );
    }

    await dbQuery(`DELETE FROM units WHERE id = :id`, { id });
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete unit" }, { status: 500 });
  }
}
