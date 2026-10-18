import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import type Stripe from "stripe";

/**
 * POST /api/checkout-session/public
 * Public (no auth) — creates a Stripe checkout session for a NEEDS_PAYMENT stay.
 * Requires a public_token to prevent sequential ID enumeration.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const stayId = Number(body?.stayId);
    const publicToken = body?.token as string | undefined;
    if (!stayId) {
      return NextResponse.json({ error: "stayId is required" }, { status: 400 });
    }
    if (!publicToken) {
      return NextResponse.json({ error: "token is required" }, { status: 400 });
    }

    if (!process.env.FRONTEND_URL) {
      return NextResponse.json(
        { error: "FRONTEND_URL is not configured on the server" },
        { status: 500 }
      );
    }

    const rows = await dbQuery(
      `SELECT gs.id, gs.unit_id, gs.status, gs.start_date, gs.end_date,
              COALESCE(gs.vehicle_plate, gs.plate_number) AS vehicle_plate,
              gs.vehicle_desc, gs.billable_nights, gs.amount_cents,
              u.unit_number, g.email AS guest_email
       FROM guest_stays gs
       INNER JOIN units u ON u.id = gs.unit_id
       INNER JOIN guests g ON g.id = gs.guest_id
       WHERE gs.id = :id AND gs.public_token = :publicToken AND gs.status = 'NEEDS_PAYMENT'`,
      { id: stayId, publicToken }
    );

    if (!rows?.length) {
      return NextResponse.json(
        { error: "Stay not found or not awaiting payment" },
        { status: 404 }
      );
    }

    const stay = rows[0];
    const amountCents = Number(stay.amount_cents) || 0;
    if (amountCents <= 0) {
      return NextResponse.json({ error: "No payment required" }, { status: 400 });
    }

    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json(
        { error: "Payment provider not configured" },
        { status: 503 }
      );
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
              description: `${stay.billable_nights} billable night(s)`,
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

    if (embedded) {
      return NextResponse.json({ clientSecret: session.client_secret });
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("[checkout-session/public] POST error:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
