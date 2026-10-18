import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { sendParkingEmail } from "@/lib/mailer";
import { formatShortDate } from "@/lib/helpers";
import { refreshPendingStayBilling } from "@/lib/billing";

/**
 * POST /api/webhooks/stripe
 * Stripe webhook handler — confirms payment even if the user closes their browser
 * before the client-side redirect fires.
 *
 * Listens for checkout.session.completed events.
 * Requires STRIPE_WEBHOOK_SECRET env var.
 */
export async function POST(request: NextRequest) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }

  const body = await request.text();
  const sig = request.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: unknown) {
    console.error("[stripe-webhook] Signature verification failed:", (err as Error)?.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    if (session.payment_status !== "paid") {
      return NextResponse.json({ received: true });
    }

    // Handle pass bundle payments
    if (session.metadata?.type === "pass_bundle") {
      const passCount = Number(session.metadata.passCount);
      const residentId = Number(session.metadata.residentId);
      const bundleType = session.metadata.bundleType || "";
      const amountCents = session.amount_total || 0;

      if (passCount && residentId) {
        try {
          // Idempotent insert — ON CONFLICT DO NOTHING
          const insertRows = await dbQuery(
            `INSERT INTO resident_pass_purchases (resident_id, stripe_session_id, bundle_type, pass_count, amount_cents, applied_at)
             VALUES (:residentId, :sessionId, :bundleType, :passCount, :amountCents, NOW())
             ON CONFLICT (stripe_session_id) DO NOTHING
             RETURNING id`,
            { residentId, sessionId: session.id, bundleType, passCount, amountCents }
          );

          // Only increment bonus_free_nights if this is a new purchase (row was inserted)
          if (insertRows.length > 0) {
            await dbQuery(
              `UPDATE residents SET bonus_free_nights = bonus_free_nights + :passCount WHERE id = :residentId`,
              { passCount, residentId }
            );
            console.log(`[stripe-webhook] Credited ${passCount} bonus passes to resident ${residentId}`);

            // GP-DECREMENT-01 fix: Recalculate billing for PENDING stays after pass purchase
            // so residents see the updated (lower) cost reflecting their new passes
            await refreshPendingStayBilling(residentId);
          }
        } catch (bundleErr) {
          console.error("[stripe-webhook] Failed to credit pass bundle:", bundleErr);
        }
      }

      return NextResponse.json({ received: true });
    }

    // Handle guest stay payments
    const stayId = Number(session.metadata?.stayId);
    if (!stayId) {
      console.error("[stripe-webhook] No stayId in session metadata");
      return NextResponse.json({ received: true });
    }

    // Check if already processed (idempotent)
    const stayRows = await dbQuery(
      `SELECT gs.id, gs.status, gs.unit_id, gs.start_date, gs.end_date,
              gs.public_token,
              COALESCE(gs.vehicle_plate, gs.plate_number) AS vehicle_plate,
              gs.vehicle_desc,
              u.unit_number,
              g.email AS guest_email
       FROM guest_stays gs
       INNER JOIN units u ON u.id = gs.unit_id
       INNER JOIN guests g ON g.id = gs.guest_id
       WHERE gs.id = :stayId`,
      { stayId }
    );

    if (!stayRows?.length) {
      console.error("[stripe-webhook] Stay not found:", stayId);
      return NextResponse.json({ received: true });
    }

    const stay = stayRows[0];
    if (stay.status === "PAID") {
      return NextResponse.json({ received: true, alreadyProcessed: true });
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
      { stayId, amountCents, currency, stripeSessionId: session.id }
    );

    // Send guest permit email
    if (stay.guest_email) {
      try {
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
      } catch (emailErr) {
        console.error("[stripe-webhook] Failed to send permit email:", emailErr);
      }
    }
  }

  return NextResponse.json({ received: true });
}
