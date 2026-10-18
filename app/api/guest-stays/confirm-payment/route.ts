import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { sendParkingEmail } from "@/lib/mailer";
import { getStripe } from "@/lib/stripe";
import { formatShortDate } from "@/lib/helpers";

/**
 * POST /api/guest-stays/confirm-payment
 * Verifies payment with Stripe, updates guest_stays status to PAID,
 * and sends the guest permit email.
 * No auth required — the Stripe session_id itself is proof of payment.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { session_id } = body || {};
    if (!session_id) {
      return NextResponse.json(
        { error: "session_id is required" },
        { status: 400 }
      );
    }

    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json(
        { error: "Payment provider not configured" },
        { status: 503 }
      );
    }

    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (!session) {
      return NextResponse.json(
        { error: "Stripe session not found" },
        { status: 404 }
      );
    }

    if (session.payment_status !== "paid") {
      return NextResponse.json(
        {
          error: "Payment has not been completed",
          payment_status: session.payment_status,
        },
        { status: 400 }
      );
    }

    const stayId = Number(session.metadata?.stayId);
    if (!stayId) {
      return NextResponse.json(
        { error: "No stayId found in session metadata" },
        { status: 400 }
      );
    }

    // Check current status to avoid double-processing
    const stayRows = await dbQuery(
      `SELECT gs.id, gs.status, gs.unit_id, gs.start_date, gs.end_date,
              gs.public_token,
              COALESCE(gs.vehicle_plate, gs.plate_number) AS vehicle_plate,
              gs.vehicle_desc,
              gs.passes_applied, gs.guest_free_pass_nights, gs.billable_nights, gs.amount_cents,
              u.unit_number,
              g.full_name AS guest_name,
              g.email AS guest_email
       FROM guest_stays gs
       INNER JOIN units u ON u.id = gs.unit_id
       INNER JOIN guests g ON g.id = gs.guest_id
       WHERE gs.id = :stayId`,
      { stayId }
    );

    if (!stayRows?.length) {
      return NextResponse.json(
        { error: "Guest stay not found" },
        { status: 404 }
      );
    }

    const stay = stayRows[0];

    // Already processed -- return success without re-updating
    if (stay.status === "PAID") {
      return NextResponse.json({
        id: stayId,
        status: "PAID",
        alreadyConfirmed: true,
        amountCents: stay.amount_cents || 0,
        billing: {
          totalNights: (stay.passes_applied || 0) + (stay.billable_nights || 0),
          passesApplied: stay.passes_applied || 0,
          guestFreePassNights: stay.guest_free_pass_nights || 0,
          billableNights: stay.billable_nights || 0,
          guestName: stay.guest_name || "",
          vehiclePlate: stay.vehicle_plate || "",
          startDate: stay.start_date,
          endDate: stay.end_date,
        },
      });
    }

    // Only NEEDS_PAYMENT stays can be confirmed — reject cancelled/pending/approved
    if (stay.status !== "NEEDS_PAYMENT") {
      return NextResponse.json(
        { error: "Stay is not awaiting payment", currentStatus: stay.status },
        { status: 409 }
      );
    }

    const amountCents = session.amount_total || 0;
    const currency = session.currency || "usd";

    await dbQuery(
      `UPDATE guest_stays
       SET status = 'PAID',
           amount_cents = :amountCents,
           currency = :currency,
           stripe_session_id = :stripeSessionId
       WHERE id = :stayId`,
      { stayId, amountCents, currency, stripeSessionId: session_id }
    );

    // Send the guest permit email now that payment is confirmed
    if (stay.guest_email) {
      const permitUrl = `${process.env.FRONTEND_URL || ""}/permit/${stayId}?token=${stay.public_token}`;
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
      id: stayId,
      status: "PAID",
      amountCents,
      currency,
      billing: {
        totalNights: (stay.passes_applied || 0) + (stay.billable_nights || 0),
        passesApplied: stay.passes_applied || 0,
        guestFreePassNights: stay.guest_free_pass_nights || 0,
        billableNights: stay.billable_nights || 0,
        guestName: stay.guest_name || "",
        vehiclePlate: stay.vehicle_plate || "",
        startDate: stay.start_date,
        endDate: stay.end_date,
      },
    });
  } catch (err) {
    console.error("[confirm-payment] POST error:", err);
    return NextResponse.json(
      { error: "Failed to confirm payment" },
      { status: 500 }
    );
  }
}
