import { NextRequest, NextResponse } from "next/server";
import { dbQuery, dbTransaction } from "@/lib/db";
import { authRequired } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { calculateStayBilling } from "@/lib/billing";
import { sendParkingEmail } from "@/lib/mailer";
import { formatShortDate } from "@/lib/helpers";
import type Stripe from "stripe";

/* ------------------------------------------------------------------ */
/*  POST /api/checkout-session  –  Create Stripe checkout session     */
/* ------------------------------------------------------------------ */
export async function POST(request: NextRequest) {
  try {
    const auth = authRequired(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const { stayId } = body || {};

    if (!stayId) {
      return NextResponse.json(
        { error: "stayId is required" },
        { status: 400 },
      );
    }

    const id = Number(stayId);
    if (!id) {
      return NextResponse.json(
        { error: "Invalid stayId" },
        { status: 400 },
      );
    }

    if (!process.env.FRONTEND_URL) {
      return NextResponse.json(
        { error: "FRONTEND_URL is not configured on the server" },
        { status: 500 },
      );
    }

    const rows = await dbQuery(
      `SELECT gs.id, gs.unit_id, gs.start_date, gs.end_date,
              gs.public_token,
              COALESCE(gs.vehicle_plate, gs.plate_number) AS vehicle_plate,
              gs.vehicle_desc, gs.passes_applied, gs.billable_nights, gs.amount_cents,
              gs.requested_by_resident_id, gs.status,
              u.unit_number,
              g.email AS guest_email
       FROM guest_stays gs
       INNER JOIN units u ON u.id = gs.unit_id
       INNER JOIN guests g ON g.id = gs.guest_id
       WHERE gs.id = :id
       LIMIT 1`,
      { id },
    );

    if (!rows?.length) {
      return NextResponse.json(
        { error: "Guest stay not found" },
        { status: 404 },
      );
    }

    const stay = rows[0];

    // Recalculate billing to account for any newly purchased passes
    let amountCents = Number(stay.amount_cents) || 0;
    let billableNights = Number(stay.billable_nights) || 0;

    if (stay.status === "NEEDS_PAYMENT" && amountCents > 0) {
      // Resolve the billing resident
      let billingResidentId = stay.requested_by_resident_id as number | null;
      if (!billingResidentId) {
        const resRows = await dbQuery(
          `SELECT id FROM residents WHERE unit_id = :unitId AND status = 'ACTIVE' ORDER BY is_primary_contact DESC, id ASC LIMIT 1`,
          { unitId: stay.unit_id },
        );
        billingResidentId = (resRows?.[0]?.id as number) || null;
      }

      if (billingResidentId) {
        const billing = await calculateStayBilling(
          billingResidentId,
          stay.start_date,
          stay.end_date,
          { plateNumber: stay.vehicle_plate },
        );

        // If billing is now lower, apply passes and update the stay
        if (billing.amountCents < amountCents) {
          amountCents = billing.amountCents;
          billableNights = billing.billableNights;

          const passesApplied =
            (billing.guestFreePassApplied || 0) +
            (billing.bonusNightsApplied || 0) +
            (billing.freeNightsApplied || 0);

          const newStatus = amountCents <= 0 ? "APPROVED" : "NEEDS_PAYMENT";

          await dbTransaction(async (client) => {
            // Acquire locks to prevent race conditions with concurrent checkout sessions
            await dbQuery(
              `SELECT id FROM guest_stays WHERE id = :id FOR UPDATE`,
              { id },
              client,
            );
            await dbQuery(
              `SELECT id FROM residents WHERE id = :residentId FOR UPDATE`,
              { residentId: billingResidentId },
              client,
            );
            await dbQuery(
              `SELECT id FROM resident_free_pass_months WHERE resident_id = :residentId FOR UPDATE`,
              { residentId: billingResidentId },
              client,
            );

            await dbQuery(
              `UPDATE guest_stays
               SET status = :status, passes_applied = :passesApplied,
                   billable_nights = :billableNights, amount_cents = :amountCents
               WHERE id = :id`,
              { id, status: newStatus, passesApplied, billableNights, amountCents },
              client,
            );

            if (billing.bonusNightsApplied > 0) {
              await dbQuery(
                `UPDATE residents SET bonus_free_nights = GREATEST(0, bonus_free_nights - :used) WHERE id = :residentId`,
                { used: billing.bonusNightsApplied, residentId: billingResidentId },
                client,
              );
            }

            if (billing.monthConsumptions?.length) {
              for (const mc of billing.monthConsumptions) {
                if (mc.consumed > 0) {
                  await dbQuery(
                    `UPDATE resident_free_pass_months
                     SET free_nights_used = free_nights_used + :consumed, updated_at = NOW()
                     WHERE resident_id = :residentId AND month_start = :monthStart`,
                    { residentId: billingResidentId, monthStart: mc.monthStart, consumed: mc.consumed },
                    client,
                  );
                }
              }
            }

            if (billing.guestFreePassApplied > 0) {
              await dbQuery(
                `UPDATE guest_vehicle_free_pass SET used = TRUE, guest_stay_id = :stayId, updated_at = NOW()
                 WHERE plate_number = :plate AND used = FALSE`,
                { stayId: id, plate: stay.vehicle_plate },
                client,
              );
            }
          });

          // If fully covered now, send permit email and return no-payment response
          if (amountCents <= 0) {
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
                },
              );
            }

            return NextResponse.json({
              url: null,
              requiresPayment: false,
              stayId: stay.id,
              amountCents: 0,
              recalculated: true,
            });
          }
        }
      }
    }

    if (amountCents <= 0) {
      return NextResponse.json({
        url: null,
        requiresPayment: false,
        stayId: stay.id,
        amountCents: 0,
      });
    }

    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json(
        { error: "Payment provider not configured" },
        { status: 503 },
      );
    }

    // Check for existing active checkout session to prevent double-charge
    const existingSession = await dbQuery(
      `SELECT stripe_session_id FROM guest_stays WHERE id = :id AND stripe_session_id IS NOT NULL LIMIT 1`,
      { id }
    );
    if (existingSession.length > 0 && existingSession[0].stripe_session_id) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(existingSession[0].stripe_session_id as string);
        if (existing && existing.status === "open") {
          // Reuse the existing session
          return NextResponse.json({
            url: existing.url,
            clientSecret: existing.client_secret,
            requiresPayment: true,
            stayId: stay.id,
            amountCents,
          });
        }
      } catch {
        // Session expired or invalid — create a new one
      }
    }

    const embedded = !!body.embedded;

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Guest Parking - ${stay.unit_number} - ${stay.vehicle_plate}`,
              description: `${billableNights} billable night(s)`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      customer_email: stay.guest_email || undefined,
      metadata: {
        stayId: String(stay.id),
        unitId: String(stay.unit_id),
      },
    };

    if (embedded) {
      sessionParams.ui_mode = "embedded";
      sessionParams.return_url = `${process.env.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`;
    } else {
      sessionParams.success_url = `${process.env.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`;
      sessionParams.cancel_url = `${process.env.FRONTEND_URL}/payment-cancel?session_id={CHECKOUT_SESSION_ID}`;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    // Store session ID for idempotency
    await dbQuery(
      `UPDATE guest_stays SET stripe_session_id = :sessionId WHERE id = :id`,
      { id, sessionId: session.id }
    );

    if (embedded) {
      return NextResponse.json({
        clientSecret: session.client_secret,
        requiresPayment: true,
        stayId: stay.id,
        amountCents,
      });
    }

    return NextResponse.json({
      url: session.url,
      requiresPayment: true,
      stayId: stay.id,
      amountCents,
    });
  } catch (error) {
    console.error("[checkout-session] POST error:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 },
    );
  }
}
