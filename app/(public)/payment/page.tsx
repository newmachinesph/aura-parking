"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CreditCard, Loader2, AlertTriangle, Car, Calendar } from "lucide-react";
import StripeCheckoutForm from "@/components/shared/StripeCheckout";

interface StayInfo {
  id: number;
  guestName: string;
  unitNumber: string;
  vehiclePlate: string;
  vehicleDesc: string;
  startDate: string;
  endDate: string;
  billableNights: number;
  amountCents: number;
}

function PaymentContent() {
  const searchParams = useSearchParams();
  const stayId = searchParams.get("stayId");
  const [stay, setStay] = useState<StayInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);

  useEffect(() => {
    if (!stayId) {
      setLoading(false);
      return;
    }
    fetch(`/api/guest-stays/${stayId}/payment-info`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setStay(data);
      })
      .catch(() => setError("Failed to load stay information"))
      .finally(() => setLoading(false));
  }, [stayId]);

  const checkoutBody = useMemo(
    () => ({ stayId: Number(stayId) }),
    [stayId]
  );

  if (loading) {
    return (
      <div className="bg-white rounded-[10px] border border-border overflow-hidden px-6 sm:px-8 py-6 w-full max-w-md text-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={32} className="animate-spin text-primary-500" />
          <p className="text-sm text-text-secondary">Loading payment details...</p>
        </div>
      </div>
    );
  }

  if (!stayId) {
    return (
      <div className="bg-white rounded-[10px] border border-border overflow-hidden px-6 sm:px-8 py-6 w-full max-w-md text-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
            <AlertTriangle size={32} className="text-warning" />
          </div>
          <h1 className="text-xl font-black">Invalid Payment Link</h1>
          <p className="text-sm text-text-secondary">
            This payment link is missing required information.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-[10px] border border-border overflow-hidden px-6 sm:px-8 py-6 w-full max-w-md text-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
            <AlertTriangle size={32} className="text-warning" />
          </div>
          <h1 className="text-xl font-black">Payment Unavailable</h1>
          <p className="text-sm text-text-secondary">{error}</p>
        </div>
      </div>
    );
  }

  if (!stay) return null;

  const amount = stay.amountCents / 100;
  const startFormatted = new Date(stay.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endFormatted = new Date(stay.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div className="bg-white rounded-[10px] border border-border overflow-hidden px-6 sm:px-8 py-6 w-full max-w-lg">
      <div className="flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center">
          <CreditCard size={32} className="text-primary-500" />
        </div>
        <h1 className="text-xl font-black">Guest Parking Payment</h1>
        <p className="text-sm text-text-secondary text-center">
          Complete payment to confirm the parking stay.
        </p>
      </div>

      <div className="bg-surface-container rounded-[10px] p-4 mt-4 flex flex-col gap-2">
        <div className="flex justify-between text-sm">
          <span className="text-text-secondary">Guest</span>
          <span className="font-medium">{stay.guestName}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-text-secondary">Unit</span>
          <span className="font-medium">{stay.unitNumber}</span>
        </div>
        <div className="flex justify-between text-sm items-center">
          <span className="text-text-secondary flex items-center gap-1"><Car size={14} /> Vehicle</span>
          <span className="font-medium">{stay.vehiclePlate}</span>
        </div>
        <div className="flex justify-between text-sm items-center">
          <span className="text-text-secondary flex items-center gap-1"><Calendar size={14} /> Dates</span>
          <span className="font-medium">{startFormatted} - {endFormatted}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-text-secondary">Billable nights</span>
          <span className="font-medium">{stay.billableNights}</span>
        </div>
        <div className="flex justify-between text-sm border-t border-border pt-2 mt-1">
          <span className="font-semibold">Total</span>
          <span className="font-bold text-lg">${amount.toFixed(2)}</span>
        </div>
      </div>

      {showCheckout ? (
        <div className="mt-4">
          <StripeCheckoutForm
            endpoint="/api/checkout-session/public"
            body={checkoutBody}
          />
        </div>
      ) : (
        <button
          className="w-full mt-4 flex items-center justify-center gap-2 bg-primary-500 text-white font-semibold py-3 rounded-[10px] cursor-pointer active:scale-[0.98] transition-transform"
          onClick={() => setShowCheckout(true)}
        >
          <CreditCard size={16} /> Pay ${amount.toFixed(2)}
        </button>
      )}
    </div>
  );
}

export default function PaymentPage() {
  return (
    <Suspense fallback={<div className="text-white">Loading...</div>}>
      <PaymentContent />
    </Suspense>
  );
}
