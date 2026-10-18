"use client";

import { useCallback, useState } from "react";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";
import { getStripeClient } from "@/lib/stripe-client";
import { CheckCircle } from "lucide-react";

interface StripeCheckoutProps {
  /** API endpoint to POST to for creating the embedded checkout session */
  endpoint: string;
  /** Body to send with the POST request */
  body: Record<string, unknown>;
  /** Called when the API responds that no payment is needed (passes covered the cost) */
  onNoPaymentRequired?: () => void;
}

export default function StripeCheckoutForm({
  endpoint,
  body,
  onNoPaymentRequired,
}: StripeCheckoutProps) {
  const [covered, setCovered] = useState(false);

  const fetchClientSecret = useCallback(async () => {
    const res = await fetch(endpoint, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, embedded: true }),
    });
    const data = await res.json();

    // API recalculated and passes now cover the full cost
    if (data.requiresPayment === false) {
      setCovered(true);
      onNoPaymentRequired?.();
      return "__no_payment__";
    }

    if (!data.clientSecret) {
      throw new Error(data.error || "Failed to create checkout session");
    }
    return data.clientSecret;
  }, [endpoint, body, onNoPaymentRequired]);

  if (covered) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
          <CheckCircle size={28} className="text-green-600" />
        </div>
        <p className="font-bold text-lg">No Payment Needed!</p>
        <p className="text-sm text-text-secondary">
          Your passes now cover this stay. The guest has been approved.
        </p>
      </div>
    );
  }

  return (
    <EmbeddedCheckoutProvider
      stripe={getStripeClient()}
      options={{ fetchClientSecret }}
    >
      <EmbeddedCheckout className="min-h-[400px]" />
    </EmbeddedCheckoutProvider>
  );
}
