import { NextRequest, NextResponse } from "next/server";
import { dbQuery, dbTransaction } from "@/lib/db";
import { authRequired } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { calculateStayBilling, refreshPendingStayBilling } from "@/lib/billing";
import { sendParkingEmail } from "@/lib/mailer";
import { formatShortDate } from "@/lib/helpers";

/**
 * POST /api/pass-bundles/confirm
 * Confirm a completed Stripe session and credit bonus passes to the resident.
 * Then recalculate any NEEDS_PAYMENT stays to apply the new passes.
 * Idempotent — safe to call multiple times with the same session_id.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = authRequired(request);
    if (auth instanceof NextResponse) return auth;
    if (auth.role !== "resident") {
      return NextResponse.json({ error: "Resident access required" }, { status: 403 });
    }

    const body = await request.json();
    const sessionId = body?.session_id as string;

    if (!sessionId) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 });
    }

    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json({ error: "Payment provider not configured" }, { status: 503 });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
    }

    if (session.metadata?.type !== "pass_bundle") {
      return NextResponse.json({ error: "Invalid session type" }, { status: 400 });
    }

    const passCount = Number(session.metadata.passCount);
    const residentId = Number(session.metadata.residentId);
    const bundleType = session.metadata.bundleType || "";
    const amountCents = session.amount_total || 0;

    if (!passCount || !residentId) {
      return NextResponse.json({ error: "Invalid session metadata" }, { status: 400 });
    }

    // Verify the resident matches the authenticated user
    if (residentId !== Number(auth.residentId)) {
      return NextResponse.json({ error: "Session does not belong to this resident" }, { status: 403 });
    }

    // Idempotent insert — ON CONFLICT DO NOTHING
    const insertRows = await dbQuery(
      `INSERT INTO resident_pass_purchases (resident_id, stripe_session_id, bundle_type, pass_count, amount_cents, applied_at)
       VALUES (:residentId, :sessionId, :bundleType, :passCount, :amountCents, NOW())
       ON CONFLICT (stripe_session_id) DO NOTHING
       RETURNING id`,
      { residentId, sessionId, bundleType, passCount, amountCents }
    );

    // Only increment bonus_free_nights if this is a new purchase (row was inserted)
    if (insertRows.length > 0) {
      await dbQuery(
        `UPDATE residents SET bonus_free_nights = bonus_free_nights + :passCount WHERE id = :residentId`,
        { passCount, residentId }
      );
    }

    // Recalculate NEEDS_PAYMENT stays to apply newly available passes
    const staysRecalculated = await recalculateNeedsPaymentStays(residentId);

    // GP-DECREMENT-01 fix: Also refresh billing estimates for PENDING stays
    // so the dashboard shows updated amounts immediately
    await refreshPendingStayBilling(residentId);

    // Return current balance
    const balanceRows = await dbQuery(
      `SELECT bonus_free_nights FROM residents WHERE id = :residentId LIMIT 1`,
      { residentId }
    );
    const bonusBalance = Number((balanceRows[0] as Record<string, unknown>)?.bonus_free_nights ?? 0);

    return NextResponse.json({ passCount, bonusBalance, staysRecalculated });
  } catch (error: unknown) {
    console.error(error);
    return NextResponse.json(
      { error: "Failed to confirm purchase" },
      { status: 500 }
    );
  }
}

/**
 * After new passes are credited, recalculate all NEEDS_PAYMENT stays for
 * the resident and apply any newly available bonus/monthly passes.
 */
async function recalculateNeedsPaymentStays(residentId: number): Promise<number> {
  // Find the resident's unit
  const resRows = await dbQuery(
    `SELECT unit_id FROM residents WHERE id = :residentId LIMIT 1`,
    { residentId }
  );
  if (!resRows?.length) return 0;
  const unitId = resRows[0].unit_id;

  // Fetch all NEEDS_PAYMENT stays for this unit, oldest first
  const stays = await dbQuery(
    `SELECT gs.id, gs.start_date, gs.end_date,
            gs.public_token,
            COALESCE(gs.vehicle_plate, gs.plate_number) AS vehicle_plate,
            gs.vehicle_desc, gs.billable_nights, gs.amount_cents,
            u.unit_number,
            g.email AS guest_email
     FROM guest_stays gs
     INNER JOIN units u ON u.id = gs.unit_id
     INNER JOIN guests g ON g.id = gs.guest_id
     WHERE gs.unit_id = :unitId AND gs.status = 'NEEDS_PAYMENT'
     ORDER BY gs.start_date ASC`,
    { unitId }
  );

  if (!stays?.length) return 0;

  let recalculated = 0;

  for (const stay of stays) {
    const billing = await calculateStayBilling(
      residentId,
      stay.start_date,
      stay.end_date,
      { plateNumber: stay.vehicle_plate }
    );

    // Skip if billing hasn't changed (no new passes to apply)
    const oldBillable = Number(stay.billable_nights) || 0;
    if (billing.billableNights >= oldBillable) continue;

    const newStatus = billing.amountCents <= 0 ? "APPROVED" : "NEEDS_PAYMENT";
    const passesApplied =
      (billing.guestFreePassApplied || 0) +
      (billing.bonusNightsApplied || 0) +
      (billing.freeNightsApplied || 0);

    const guestFreePassNights = billing.guestFreePassApplied || 0;

    await dbTransaction(async (client) => {
      await dbQuery(
        `UPDATE guest_stays
         SET status = :status,
             passes_applied = :passesApplied,
             guest_free_pass_nights = :guestFreePassNights,
             billable_nights = :billableNights,
             amount_cents = :amountCents
         WHERE id = :stayId`,
        {
          stayId: stay.id,
          status: newStatus,
          passesApplied,
          guestFreePassNights,
          billableNights: billing.billableNights,
          amountCents: billing.amountCents,
        },
        client
      );

      // Debit bonus passes used
      if (billing.bonusNightsApplied > 0) {
        await dbQuery(
          `UPDATE residents
           SET bonus_free_nights = GREATEST(0, bonus_free_nights - :used)
           WHERE id = :residentId`,
          { used: billing.bonusNightsApplied, residentId },
          client
        );
      }

      // Debit monthly free passes used
      if (billing.monthConsumptions?.length) {
        for (const mc of billing.monthConsumptions) {
          if (mc.consumed > 0) {
            await dbQuery(
              `UPDATE resident_free_pass_months
               SET free_nights_used = free_nights_used + :consumed,
                   updated_at = NOW()
               WHERE resident_id = :residentId AND month_start = :monthStart`,
              { residentId, monthStart: mc.monthStart, consumed: mc.consumed },
              client
            );
          }
        }
      }

      // Mark guest vehicle free pass as used if applied
      if (billing.guestFreePassApplied > 0) {
        await dbQuery(
          `UPDATE guest_vehicle_free_pass
           SET used = TRUE, guest_stay_id = :stayId, updated_at = NOW()
           WHERE plate_number = :plate AND used = FALSE`,
          { stayId: stay.id, plate: stay.vehicle_plate },
          client
        );
      }
    });

    // If fully covered, send permit email
    if (newStatus === "APPROVED" && stay.guest_email) {
      const permitUrl = `${process.env.FRONTEND_URL || ""}/permit/${stay.id}?token=${stay.public_token}`;
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

    recalculated++;
  }

  return recalculated;
}
