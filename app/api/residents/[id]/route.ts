import { NextRequest, NextResponse } from "next/server";
import { dbQuery, dbTransaction } from "@/lib/db";
import { authRequired } from "@/lib/auth";

/**
 * PATCH /api/residents/:id
 * Update resident details (admin only): name, email, unit number.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authRequired(request);
    if (auth instanceof NextResponse) return auth;
    if (auth.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!id) {
      return NextResponse.json({ error: "Invalid resident id" }, { status: 400 });
    }

    const body = await request.json();
    const { fullName, email, unitNumber, status } = body || {};

    // Check resident exists
    const rows = await dbQuery(
      `SELECT r.id, r.unit_id FROM residents r WHERE r.id = :id LIMIT 1`,
      { id }
    );
    if (!rows?.length) {
      return NextResponse.json({ error: "Resident not found" }, { status: 404 });
    }

    const resident = rows[0];

    // Update unit number if provided
    if (unitNumber != null && String(unitNumber).trim()) {
      const trimmed = String(unitNumber).trim();
      // Upsert unit
      const unitRows = await dbQuery(
        `INSERT INTO units (unit_number)
         VALUES (:unitNumber)
         ON CONFLICT (unit_number) DO UPDATE SET unit_number = EXCLUDED.unit_number
         RETURNING id`,
        { unitNumber: trimmed }
      );
      const newUnitId = unitRows.insertId;
      if (newUnitId !== resident.unit_id) {
        await dbQuery(
          `UPDATE residents SET unit_id = :unitId WHERE id = :id`,
          { id, unitId: newUnitId }
        );
      }
    }

    // Update name and email
    const updates: string[] = [];
    const values: Record<string, unknown> = { id };

    if (fullName != null && String(fullName).trim()) {
      updates.push("full_name = :fullName");
      values.fullName = String(fullName).trim();
    }
    if (email != null && String(email).trim()) {
      updates.push("email = :email");
      values.email = String(email).trim().toLowerCase();
    }
    if (status != null && ["ACTIVE", "INACTIVE", "PENDING"].includes(String(status).toUpperCase())) {
      updates.push("status = :status");
      values.status = String(status).toUpperCase();
    }

    if (updates.length > 0) {
      await dbQuery(
        `UPDATE residents SET ${updates.join(", ")} WHERE id = :id`,
        values
      );
    }

    // Sync email and status changes to auth_users so login stays consistent
    const authUpdates: string[] = [];
    const authValues: Record<string, unknown> = { residentId: id };

    if (values.email) {
      authUpdates.push("email = :email");
      authValues.email = values.email;
    }
    if (values.status) {
      authUpdates.push("status = :status");
      authValues.status = values.status;
    }
    if (authUpdates.length > 0) {
      await dbQuery(
        `UPDATE auth_users SET ${authUpdates.join(", ")} WHERE resident_id = :residentId`,
        authValues
      );
    }

    return NextResponse.json({ id, status: "ok" });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to update resident" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/residents/:id
 * Delete a resident and their auth user (admin only).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authRequired(request);
    if (auth instanceof NextResponse) return auth;
    if (auth.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!id) {
      return NextResponse.json({ error: "Invalid resident id" }, { status: 400 });
    }

    // Delete in a transaction: clean up related records, then resident + auth
    await dbTransaction(async (client) => {
      // Nullify guest_stays references so they become orphan-safe
      await dbQuery(
        `UPDATE guest_stays SET requested_by_resident_id = NULL WHERE requested_by_resident_id = :id`,
        { id },
        client
      );
      // Clean up free pass records
      await dbQuery(`DELETE FROM resident_free_pass_months WHERE resident_id = :id`, { id }, client);
      // Delete auth user
      await dbQuery(`DELETE FROM auth_users WHERE resident_id = :id`, { id }, client);
      // Delete resident
      await dbQuery(`DELETE FROM residents WHERE id = :id`, { id }, client);
    });

    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete resident" }, { status: 500 });
  }
}
