import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { authRequired } from "@/lib/auth";
import { sendParkingEmail } from "@/lib/mailer";
import { formatShortDate, toSqlDate, normalizePlate, todayMST } from "@/lib/helpers";
import { calculateStayBilling, refreshPendingStayBilling } from "@/lib/billing";

/**
 * DELETE /api/guest-stays/:id
 * Cancel (soft-delete) a guest stay — sets status to CANCELLED.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authRequired(request);
    if (auth instanceof NextResponse) return auth;

    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!id) {
      return NextResponse.json(
        { error: "Invalid guest stay id" },
        { status: 400 }
      );
    }

    const rows = await dbQuery(
      `SELECT gs.id, gs.status, gs.unit_id, gs.vehicle_plate, gs.vehicle_desc,
              gs.start_date, gs.end_date,
              u.unit_number,
              g.email AS guest_email
       FROM guest_stays gs
       INNER JOIN units u ON u.id = gs.unit_id
       INNER JOIN guests g ON g.id = gs.guest_id
       WHERE gs.id = :id LIMIT 1`,
      { id }
    );

    if (!rows?.length) {
      return NextResponse.json(
        { error: "Guest stay not found" },
        { status: 404 }
      );
    }

    const stay = rows[0];

    // IDOR check: residents can only cancel their own unit's stays
    if (auth.role === "resident") {
      if (!auth.residentId) {
        return NextResponse.json({ error: "Resident account not linked" }, { status: 403 });
      }
      const resRows = await dbQuery(
        `SELECT unit_id FROM residents WHERE id = :residentId`,
        { residentId: auth.residentId }
      );
      if (!resRows?.length || resRows[0].unit_id !== stay.unit_id) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
    }

    const cancellableStatuses = ["PENDING", "NEEDS_PAYMENT"];
    if (!cancellableStatuses.includes(String(stay.status))) {
      return NextResponse.json(
        { error: "Only PENDING or NEEDS_PAYMENT stays can be cancelled" },
        { status: 409 }
      );
    }

    await dbQuery(
      `UPDATE guest_stays
       SET status = 'CANCELLED'
       WHERE id = :id`,
      { id }
    );

    // Send rejection email to the guest
    if (stay.guest_email) {
      try {
        await sendParkingEmail(
          stay.guest_email as string,
          "Parking Request Declined",
          "request_rejected_guest",
          {
            unit_number: stay.unit_number,
            vehicle_plate: stay.vehicle_plate,
            vehicle_desc: stay.vehicle_desc || "",
            stay_start: formatShortDate(stay.start_date as string),
            stay_end: formatShortDate(stay.end_date as string),
          }
        );
      } catch (emailErr: unknown) {
        console.error(
          "[email] Failed to send rejection email:",
          (emailErr as Error)?.message
        );
      }
    }

    return NextResponse.json({ id, status: "CANCELLED" });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to cancel guest stay" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/guest-stays/:id
 * Update guest stay details (name / plate / vehicle / dates).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authRequired(request);
    if (auth instanceof NextResponse) return auth;

    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!id) {
      return NextResponse.json(
        { error: "Invalid guest stay id" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { guestName, vehiclePlate, vehicleDesc, startDate, endDate } =
      body || {};

    const rows = await dbQuery(
      `SELECT gs.id, gs.status, gs.guest_id, gs.unit_id,
              gs.requested_by_resident_id,
              COALESCE(gs.vehicle_plate, gs.plate_number) AS old_plate,
              gs.start_date, gs.end_date,
              gs.amount_cents AS existing_amount_cents,
              gs.billable_nights AS existing_billable_nights,
              gs.passes_applied AS existing_passes_applied,
              gs.guest_free_pass_nights AS existing_gfp_nights
       FROM guest_stays gs
       WHERE gs.id = :id
       LIMIT 1`,
      { id }
    );

    if (!rows?.length) {
      return NextResponse.json(
        { error: "Guest stay not found" },
        { status: 404 }
      );
    }

    const stay = rows[0];

    // IDOR check: residents can only edit their own unit's stays
    if (auth.role === "resident") {
      if (!auth.residentId) {
        return NextResponse.json({ error: "Resident account not linked" }, { status: 403 });
      }
      const resRows = await dbQuery(
        `SELECT unit_id FROM residents WHERE id = :residentId`,
        { residentId: auth.residentId }
      );
      if (!resRows?.length || resRows[0].unit_id !== stay.unit_id) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
    }

    const stayStatus = String(stay.status).toUpperCase();
    if (stayStatus === "CANCELLED") {
      return NextResponse.json(
        { error: "Cancelled stays cannot be edited" },
        { status: 409 }
      );
    }
    if (stayStatus === "PAID") {
      return NextResponse.json(
        { error: "Paid stays cannot be edited" },
        { status: 409 }
      );
    }

    // Normalize plate
    const normalizedPlate = vehiclePlate ? normalizePlate(vehiclePlate) : null;

    // Cross-unit plate conflict check (only when plate is being changed)
    if (normalizedPlate) {
      const today = todayMST();
      const conflictRows = await dbQuery(
        `SELECT gs.id, u.unit_number
         FROM guest_stays gs
         INNER JOIN units u ON u.id = gs.unit_id
         WHERE gs.plate_number = :plate
           AND gs.status IN ('PENDING', 'APPROVED', 'NEEDS_PAYMENT', 'PAID')
           AND gs.end_date >= :today
           AND gs.unit_id != :unitId
           AND gs.id != :excludeId
         LIMIT 1`,
        { plate: normalizedPlate, today, unitId: stay.unit_id, excludeId: id }
      );
      if (conflictRows?.length) {
        const conflictUnit = conflictRows[0].unit_number;
        return NextResponse.json(
          { error: `This vehicle already has an active parking pass with Unit ${conflictUnit}. A vehicle can only hold one guest pass at a time.` },
          { status: 409 }
        );
      }
    }

    // Update stay fields
    await dbQuery(
      `UPDATE guest_stays
       SET vehicle_plate = COALESCE(:vehiclePlate, vehicle_plate),
           plate_number = COALESCE(:vehiclePlate, plate_number),
           vehicle_desc = COALESCE(:vehicleDesc, vehicle_desc),
           start_date = COALESCE(:startDate, start_date),
           end_date = COALESCE(:endDate, end_date)
       WHERE id = :id`,
      {
        id,
        vehiclePlate: normalizedPlate,
        vehicleDesc: vehicleDesc == null ? null : String(vehicleDesc),
        startDate: startDate ? toSqlDate(startDate) : null,
        endDate: endDate ? toSqlDate(endDate) : null,
      }
    );

    // Recalculate billing if plate or dates changed (and stay isn't already PAID)
    const plateChanged = normalizedPlate && normalizedPlate !== String(stay.old_plate || "").trim().toUpperCase().replace(/[\s-]/g, "");
    const datesChanged = !!(startDate || endDate);
    if ((plateChanged || datesChanged) && String(stay.status) !== "PAID") {
      const residentId = stay.requested_by_resident_id as number | null;
      if (residentId) {
        const effectiveStart = startDate ? toSqlDate(startDate) : stay.start_date;
        const effectiveEnd = endDate ? toSqlDate(endDate) : stay.end_date;
        const effectivePlate = normalizedPlate || String(stay.old_plate || "").trim().toUpperCase().replace(/[\s-]/g, "");

        // Ensure free pass record exists for the plate
        if (plateChanged) {
          await dbQuery(
            `INSERT INTO guest_vehicle_free_pass (plate_number, free_pass)
             VALUES (:plate, 1)
             ON CONFLICT (plate_number) DO UPDATE SET plate_number = EXCLUDED.plate_number`,
            { plate: normalizedPlate }
          );
        }

        const billing = await calculateStayBilling(residentId, effectiveStart, effectiveEnd, { plateNumber: effectivePlate });
        const passesApplied = ((billing.guestFreePassApplied as number) || 0) + ((billing.bonusNightsApplied as number) || 0) + ((billing.freeNightsApplied as number) || 0);

        // For already-approved/needs_payment stays, compute INCREMENTAL billing.
        // Passes were already consumed at approval time, so calculateStayBilling
        // won't find them in the pool. We need to account for the original billing
        // and only charge the difference for added nights.
        const existingAmountCents = Number(stay.existing_amount_cents || 0);
        const existingBillableNights = Number(stay.existing_billable_nights || 0);
        const existingPassesApplied = Number(stay.existing_passes_applied || 0);
        const existingGfpNights = Number(stay.existing_gfp_nights || 0);

        let finalBillableNights: number;
        let finalAmountCents: number;
        let finalPassesApplied: number;
        let finalGfpNights: number;

        if (stayStatus === "PENDING") {
          // PENDING stays haven't consumed passes yet — use fresh calculation
          finalBillableNights = billing.billableNights;
          finalAmountCents = billing.amountCents;
          finalPassesApplied = passesApplied;
          finalGfpNights = (billing.guestFreePassApplied as number) || 0;
        } else {
          // APPROVED / NEEDS_PAYMENT: passes already consumed.
          // The fresh calculation sees 0 available passes → charges full amount.
          // Correct approach: keep the original covered nights, only charge new nights.
          const originalTotalNights = existingBillableNights + existingPassesApplied;
          const newTotalNights = billing.totalNights;
          const addedNights = Math.max(0, newTotalNights - originalTotalNights);
          // Added nights are billable (passes were already consumed for original nights)
          finalBillableNights = existingBillableNights + addedNights;
          finalAmountCents = finalBillableNights * billing.rateCentsPerNight;
          finalPassesApplied = existingPassesApplied;
          finalGfpNights = existingGfpNights;
        }

        let newStatus = stayStatus;
        if (stayStatus !== "PENDING") {
          newStatus = finalAmountCents <= 0 ? "APPROVED" : "NEEDS_PAYMENT";
        }

        await dbQuery(
          `UPDATE guest_stays SET status = :status, passes_applied = :passesApplied,
           guest_free_pass_nights = :guestFreePassNights,
           billable_nights = :billableNights, amount_cents = :amountCents WHERE id = :id`,
          { id, status: newStatus, passesApplied: finalPassesApplied, guestFreePassNights: finalGfpNights, billableNights: finalBillableNights, amountCents: finalAmountCents }
        );

        // GP-DECREMENT-01 fix: Refresh billing for other pending stays after edit
        await refreshPendingStayBilling(residentId);
      }
    }

    // Update guest name (optional)
    if (guestName != null && String(guestName).trim()) {
      await dbQuery(
        `UPDATE guests
         SET full_name = :fullName
         WHERE id = :guestId`,
        { guestId: stay.guest_id, fullName: String(guestName).trim() }
      );
    }

    return NextResponse.json({ id, status: "ok" });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to update guest stay" },
      { status: 500 }
    );
  }
}
