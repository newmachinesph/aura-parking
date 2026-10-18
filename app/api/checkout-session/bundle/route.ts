import { NextRequest, NextResponse } from "next/server";
import { authRequired } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import type Stripe from "stripe";

const BUNDLES = {
  "3-pass": { passCount: 3, amountCents: 1275, label: "3-Pass Bundle (15% off)" },
  "5-pass": { passCount: 5, amountCents: 2000, label: "5-Pass Bundle (20% off)" },
} as const;

type BundleType = keyof typeof BUNDLES;

/**
 * POST /api/checkout-session/bundle
 * Create a Stripe Checkout session for a pass bundle purchase.
 * Supports embedded mode (embedded: true → returns clientSecret).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = authRequired(request);
    if (auth instanceof NextResponse) return auth;
    if (auth.role !== "resident") {
      return NextResponse.json({ error: "Resident access required" }, { status: 403 });
    }

    const body = await request.json();
    const bundleType = body?.bundleType as string;

    if (!bundleType || !(bundleType in BUNDLES)) {
      return NextResponse.json(
        { error: "Invalid bundleType. Must be '3-pass' or '5-pass'" },
        { status: 400 }
      );
    }

    if (!process.env.FRONTEND_URL) {
      return NextResponse.json(
        { error: "FRONTEND_URL is not configured on the server" },
        { status: 500 }
      );
    }

    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json(
        { error: "Payment provider not configured" },
        { status: 503 }
      );
    }

    const bundle = BUNDLES[bundleType as BundleType];
    const embedded = !!body.embedded;

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: bundle.label,
              description: `${bundle.passCount} guest parking passes`,
            },
            unit_amount: bundle.amountCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      metadata: {
        type: "pass_bundle",
        bundleType,
        passCount: String(bundle.passCount),
        residentId: String(auth.residentId),
        userId: String(auth.sub),
      },
    };

    if (embedded) {
      sessionParams.ui_mode = "embedded";
      sessionParams.return_url = `${process.env.FRONTEND_URL}/dashboard/passes?session_id={CHECKOUT_SESSION_ID}`;
    } else {
      sessionParams.success_url = `${process.env.FRONTEND_URL}/dashboard/passes?session_id={CHECKOUT_SESSION_ID}`;
      sessionParams.cancel_url = `${process.env.FRONTEND_URL}/dashboard/passes?cancelled=1`;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    if (embedded) {
      return NextResponse.json({
        clientSecret: session.client_secret,
        amountCents: bundle.amountCents,
      });
    }

    return NextResponse.json({
      url: session.url,
      amountCents: bundle.amountCents,
    });
  } catch (error: unknown) {
    console.error(error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
