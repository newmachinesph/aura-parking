import { NextRequest, NextResponse } from "next/server";
import { authRequired } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";

/* ------------------------------------------------------------------ */
/*  GET /api/checkout-session/:id  –  Retrieve Stripe session         */
/* ------------------------------------------------------------------ */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = authRequired(request);
    if (auth instanceof NextResponse) return auth;

    const { id } = await params;

    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json(
        { error: "Payment provider not configured" },
        { status: 503 },
      );
    }

    const session = await stripe.checkout.sessions.retrieve(id);
    return NextResponse.json(session);
  } catch (error) {
    console.error("[checkout-session] GET error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve checkout session" },
      { status: 500 },
    );
  }
}
