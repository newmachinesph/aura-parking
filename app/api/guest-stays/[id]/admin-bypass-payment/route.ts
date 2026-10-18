import { NextRequest, NextResponse } from "next/server";
import { dbQuery, dbTransaction } from "@/lib/db";
import { authRequired } from "@/lib/auth";
import { sendParkingEmail } from "@/lib/mailer";
import { calculateStayBilling, refreshPendingStayBilling, RATE_CENTS_PER_NIGHT } from "@/lib/billing";
import { formatShortDate } from "@/lib/helpers";

/**
 * POST /api/guest-stays/:id/admin-bypass-payment
 * Admin bypasses payment: marks stay APPROVED without going through Stripe.
 * Optionally allows specifying a custom number of billable days.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authRequired(request);
    if (auth instanceof NextResponse) return auth;
    if (auth.role !== "admin" && auth.role !== "staff") {
      return NextResponse.json({ error: "Admin or staff access required" }, { status: 403 });
    }

    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!id) {
      return NextResponse.json(
        { error: "Invalid guest stay id" },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { billableDays, adminNote } = body || {};
    const customBillableDays =
      billableDays != null ? Number(billableDays) : null;

    // Get the stay info
    const rows = await dbQuery(
      `SELECT gs.id, gs.status, gs.unit_id, gs.start_date, gs.end_date,
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

    // Already processed - return success
    if (stay.status === "PAID" || stay.status === "APPROVED") {
      return NextResponse.json({
        id,
        status: stay.status,
        alreadyProcessed: true,
      });
    }

    // Only allow bypass on PENDING or NEEDS_PAYMENT stays
    const allowedStatuses = ["PENDING", "NEEDS_PAYMENT"];
    if (!allowedStatuses.includes(String(stay.status))) {
      return NextResponse.json(
        { error: `Cannot bypass payment for a ${stay.status} stay` },
        { status: 409 }
      );
    }

    // Calculate amount based on custom billable days or default billing
    let amountCents = 0;
    let billableNights = 0;
    const adminBypassNote = adminNote ? String(adminNote).slice(0, 255) : "Admin bypass";

    if (customBillableDays != null && customBillableDays >= 0) {
      // Admin specified custom billable days — no pass deduction
      billableNights = customBillableDays;
      amountCents = customBillableDays * RATE_CENTS_PER_NIGHT;

      await dbQuery(
        `UPDATE guest_stays
         SET status = 'APPROVED',
             amount_cents = :amountCents,
             currency = 'usd',
             billable_nights = :billableNights,
             admin_bypass_note = :adminBypassNote,
             approved_at = COALESCE(approved_at, NOW())
         WHERE id = :id`,
        { id, amountCents, billableNights, adminBypassNote }
      );
    } else {
      // Resolve correct resident ID
      let residentId = stay.requested_by_resident_id as number | null;
      if (!residentId) {
        const primaryRows = await dbQuery(
          `SELECT id FROM residents WHERE unit_id = :unitId AND status = 'ACTIVE' ORDER BY is_primary_contact DESC, id ASC LIMIT 1`,
          { unitId: stay.unit_id }
        );
        residentId = (primaryRows?.[0]?.id as number) || null;
      }

      if (residentId) {
        // Calculate billing + deduct passes inside a transaction with FOR UPDATE locks
        await dbTransaction(async (client) => {
          await dbQuery(
            `SELECT id FROM guest_stays WHERE id = :id FOR UPDATE`,
            { id },
            client
          );
          // Lock resident pass rows for serialization
          await dbQuery(`SELECT id FROM residents WHERE id = :residentId FOR UPDATE`, { residentId }, client);
          await dbQuery(`SELECT id FROM resident_free_pass_months WHERE resident_id = :residentId FOR UPDATE`, { residentId }, client);
          // GP-FREEPASS-02 fix: Lock guest vehicle free pass record
          if (stay.vehicle_plate) {
            await dbQuery(`SELECT id FROM guest_vehicle_free_pass WHERE plate_number = :plate FOR UPDATE`, { plate: stay.vehicle_plate }, client);
          }

          const billing = await calculateStayBilling(
            residentId,
            stay.start_date,
            stay.end_date,
            { plateNumber: stay.vehicle_plate }
          );
          amountCents = (billing?.amountCents as number) || 0;
          billableNights = (billing?.billableNights as number) || 0;

          await dbQuery(
            `UPDATE guest_stays
             SET status = 'APPROVED',
                 amount_cents = :amountCents,
                 currency = 'usd',
                 admin_bypass_note = :adminBypassNote,
                 approved_at = COALESCE(approved_at, NOW()),
                 billable_nights = :billableNights,
                 passes_applied = :passesApplied,
                 guest_free_pass_nights = :guestFreePassNights
             WHERE id = :id`,
            {
              id,
              amountCents,
              adminBypassNote,
              billableNights,
              passesApplied:
                ((billing?.guestFreePassApplied as number) || 0) +
                ((billing?.bonusNightsApplied as number) || 0) +
                ((billing?.freeNightsApplied as number) || 0),
              guestFreePassNights: (billing?.guestFreePassApplied as number) || 0,
            },
            client
          );

          // Debit monthly accumulated passes
          const consumptions = billing?.monthConsumptions as
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
                  { residentId, monthStart: c.monthStart, consumed: c.consumed },
                  client
                );
              }
            }
          }

          // Decrement bonus_free_nights
          const bonusApplied = (billing?.bonusNightsApplied as number) || 0;
          if (bonusApplied > 0) {
            await dbQuery(
              `UPDATE residents SET bonus_free_nights = GREATEST(0, bonus_free_nights - :bonusApplied) WHERE id = :residentId`,
              { bonusApplied, residentId },
              client
            );
          }

          // Mark guest vehicle free pass as used
          if ((billing?.guestFreePassApplied as number) > 0) {
            await dbQuery(
              `UPDATE guest_vehicle_free_pass
               SET used = TRUE, guest_stay_id = :stayId, updated_at = NOW()
               WHERE plate_number = :plate AND used = FALSE`,
              { stayId: id, plate: stay.vehicle_plate },
              client
            );
          }
        });

        // Recalculate other PENDING stays since passes changed
        await refreshPendingStayBilling(residentId);
      } else {
        // No resident found — simple update, no pass deduction
        await dbQuery(
          `UPDATE guest_stays
           SET status = 'APPROVED',
               amount_cents = :amountCents,
               currency = 'usd',
               admin_bypass_note = :adminBypassNote,
               approved_at = COALESCE(approved_at, NOW())
           WHERE id = :id`,
          { id, amountCents, adminBypassNote }
        );
      }
    }

    // Send the guest permit email
    if (stay.guest_email) {
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

    return NextResponse.json({
      id,
      status: "APPROVED",
      amountCents,
      billableNights,
      adminBypassed: true,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to process admin bypass" },
      { status: 500 }
    );
  }
}
