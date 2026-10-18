import { NextRequest, NextResponse } from "next/server";
import { dbQuery, dbTransaction } from "@/lib/db";
import { authRequired } from "@/lib/auth";
import { sendParkingEmail } from "@/lib/mailer";
import { calculateStayBilling, refreshPendingStayBilling } from "@/lib/billing";
import { formatShortDate } from "@/lib/helpers";

/**
 * POST /api/guest-stays/:id/approve
 * Approve a PENDING stay: recalculate billing, update status, apply passes, send email.
 * All pass deductions run inside a DB transaction to prevent race conditions.
 */
export async function POST(
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
      `SELECT gs.id, gs.unit_id, gs.status, gs.start_date, gs.end_date,
              gs.requested_by_resident_id, gs.public_token,
              COALESCE(gs.vehicle_plate, gs.plate_number) AS vehicle_plate,
              gs.vehicle_desc,
              u.unit_number,
              g.email AS guest_email
       FROM guest_stays gs
       INNER JOIN units u ON u.id = gs.unit_id
       INNER JOIN guests g ON g.id = gs.guest_id
       WHERE gs.id = :id`,
      { id }
    );

    if (!rows?.length) {
      return NextResponse.json(
        { error: "Guest stay not found" },
        { status: 404 }
      );
    }

    const stay = rows[0];

    // Residents can only approve stays for their own unit
    if (auth.role === "resident") {
      if (!auth.residentId) {
        return NextResponse.json({ error: "Resident account not linked" }, { status: 403 });
      }
      const resRows = await dbQuery(
        `SELECT unit_id FROM residents WHERE id = :residentId`,
        { residentId: auth.residentId }
      );
      if (!resRows?.length || resRows[0].unit_id !== stay.unit_id) {
        return NextResponse.json({ error: "You can only approve stays for your own unit" }, { status: 403 });
      }
    } else if (auth.role !== "admin" && auth.role !== "staff") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    if (stay.status !== "PENDING") {
      return NextResponse.json(
        { error: "Only PENDING stays can be approved" },
        { status: 409 }
      );
    }

    // Resolve the resident for billing
    let billingResidentId = stay.requested_by_resident_id as number | null;
    if (!billingResidentId) {
      const primaryRows = await dbQuery(
        `SELECT id FROM residents WHERE unit_id = :unitId AND status = 'ACTIVE' ORDER BY is_primary_contact DESC, id ASC LIMIT 1`,
        { unitId: stay.unit_id }
      );
      billingResidentId = (primaryRows?.[0]?.id as number) || null;
    }

    // Run billing + all DB mutations in a single transaction with FOR UPDATE locks
    // to prevent TOCTOU race conditions on pass balances
    const { nextStatus, billing } = await dbTransaction(async (client) => {
      // Lock the stay row to prevent concurrent approval
      const lockRows = await dbQuery(
        `SELECT status FROM guest_stays WHERE id = :id FOR UPDATE`,
        { id },
        client
      );
      if (lockRows?.[0]?.status !== "PENDING") {
        throw new Error("ALREADY_PROCESSED");
      }

      // Lock resident pass rows to serialize concurrent approvals for the same resident
      await dbQuery(
        `SELECT id FROM residents WHERE id = :residentId FOR UPDATE`,
        { residentId: billingResidentId },
        client
      );
      await dbQuery(
        `SELECT id FROM resident_free_pass_months WHERE resident_id = :residentId FOR UPDATE`,
        { residentId: billingResidentId },
        client
      );
      // GP-FREEPASS-02 fix: Lock guest vehicle free pass record to prevent concurrent
      // approvals for the same plate from both applying the one-time free pass
      if (stay.vehicle_plate) {
        await dbQuery(
          `SELECT id FROM guest_vehicle_free_pass WHERE plate_number = :plate FOR UPDATE`,
          { plate: stay.vehicle_plate },
          client
        );
      }

      // Calculate billing INSIDE the transaction (after locks acquired)
      const txBilling = await calculateStayBilling(
        billingResidentId!,
        stay.start_date,
        stay.end_date,
        { plateNumber: stay.vehicle_plate }
      );
      const txNextStatus =
        (txBilling?.amountCents as number) > 0 ? "NEEDS_PAYMENT" : "APPROVED";

      const gfp = (txBilling?.guestFreePassApplied as number) || 0;
      const passesApplied =
        gfp +
        ((txBilling?.bonusNightsApplied as number) || 0) +
        ((txBilling?.freeNightsApplied as number) || 0);

      await dbQuery(
        `UPDATE guest_stays
         SET status = :status, approved_at = NOW(),
             passes_applied = :passesApplied, guest_free_pass_nights = :guestFreePassNights,
             billable_nights = :billableNights, amount_cents = :amountCents
         WHERE id = :id`,
        {
          id,
          status: txNextStatus,
          passesApplied,
          guestFreePassNights: gfp,
          billableNights: (txBilling?.billableNights as number) || 0,
          amountCents: (txBilling?.amountCents as number) || 0,
        },
        client
      );

      // Debit free passes from the correct source month buckets
      const consumptions = txBilling?.monthConsumptions as
        | Array<{ monthStart: string; consumed: number }>
        | undefined;
      if (consumptions?.length) {
        for (const c of consumptions) {
          if (c.consumed > 0) {
            await dbQuery(
              `UPDATE resident_free_pass_months
               SET free_nights_used = free_nights_used + :consumed,
                   updated_at = NOW()
               WHERE resident_id = :residentId AND month_start = :monthStart`,
              {
                residentId: billingResidentId,
                monthStart: c.monthStart,
                consumed: c.consumed,
              },
              client
            );
          }
        }
      }

      const bonusApplied = (txBilling?.bonusNightsApplied as number) || 0;
      if (bonusApplied > 0) {
        await dbQuery(
          `UPDATE residents SET bonus_free_nights = GREATEST(0, bonus_free_nights - :bonusApplied) WHERE id = :residentId`,
          { bonusApplied, residentId: billingResidentId },
          client
        );
      }

      if ((txBilling?.guestFreePassApplied as number) > 0) {
        await dbQuery(
          `UPDATE guest_vehicle_free_pass
           SET used = TRUE, guest_stay_id = :stayId, updated_at = NOW()
           WHERE plate_number = :plate AND used = FALSE`,
          { stayId: id, plate: stay.vehicle_plate },
          client
        );
      }

      return { nextStatus: txNextStatus, billing: txBilling };
    });

    // Recalculate billing estimates for any other PENDING stays (passes changed)
    await refreshPendingStayBilling(billingResidentId!);

    // Send the permit email outside the transaction (email failure shouldn't rollback DB)
    if (nextStatus === "APPROVED" && stay.guest_email) {
      const permitUrl = `${process.env.FRONTEND_URL || ""}/permit/${id}?token=${stay.public_token}`;
      await sendParkingEmail(
        stay.guest_email as string,
        "Parking Permit Approved",
        "guest_approval",
        {
          unit_number: stay.unit_number,
          vehicle_plate: stay.vehicle_plate,
          vehicle_desc: stay.vehicle_desc || "",
          stay_start: formatShortDate(stay.start_date as string),
          stay_end: formatShortDate(stay.end_date as string),
          action_url: permitUrl,
        }
      );
    }

    return NextResponse.json({ id, status: nextStatus, billing });
  } catch (err) {
    if ((err as Error)?.message === "ALREADY_PROCESSED") {
      return NextResponse.json(
        { error: "Stay has already been processed" },
        { status: 409 }
      );
    }
    console.error("[approve] POST error:", err);
    return NextResponse.json(
      { error: "Failed to approve guest stay" },
      { status: 500 }
    );
  }
}
