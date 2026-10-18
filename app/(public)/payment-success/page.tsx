"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle, Loader2, XCircle, AlertTriangle } from "lucide-react";
import Button from "@/components/ui/Button";

interface BillingBreakdown {
  totalNights: number;
  passesApplied: number;
  guestFreePassNights: number;
  billableNights: number;
  guestName: string;
  vehiclePlate: string;
  startDate: string;
  endDate: string;
}

function PaymentSuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [confirming, setConfirming] = useState(!!sessionId);
  const [amount, setAmount] = useState<number | null>(null);
  const [billing, setBilling] = useState<BillingBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    fetch("/api/guest-stays/confirm-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ session_id: sessionId }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to confirm payment");
        setAmount((data.amountCents || 0) / 100);
        if (data.billing) setBilling(data.billing);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to confirm payment");
      })
      .finally(() => setConfirming(false));
  }, [sessionId]);

  if (confirming) {
    return (
      <div className="bg-white rounded-[10px] border border-border overflow-hidden px-6 sm:px-8 py-6 w-full max-w-md text-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={32} className="animate-spin text-primary-500" />
          <p className="text-sm text-text-secondary">Confirming payment...</p>
        </div>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="bg-white rounded-[10px] border border-border overflow-hidden px-6 sm:px-8 py-6 w-full max-w-md text-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
            <AlertTriangle size={32} className="text-warning" />
          </div>
          <h1 className="text-xl font-black">No Payment Session</h1>
          <p className="text-sm text-text-secondary">
            No payment session found. If you completed a payment, check your email for confirmation.
          </p>
          <Link href="/dashboard" className="w-full">
            <Button className="w-full">Back to Dashboard</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-[10px] border border-border overflow-hidden px-6 sm:px-8 py-6 w-full max-w-md text-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
            <XCircle size={32} className="text-danger" />
          </div>
          <h1 className="text-xl font-black">Confirmation Failed</h1>
          <p className="text-sm text-text-secondary">{error}</p>
          <p className="text-xs text-text-secondary">
            Your payment may still have been processed. Please check your dashboard or contact support.
          </p>
          <Link href="/dashboard" className="w-full">
            <Button className="w-full">Back to Dashboard</Button>
          </Link>
        </div>
      </div>
    );
  }

  const passesFromBalance = billing ? Math.max(0, billing.passesApplied - billing.guestFreePassNights) : 0;
  const isFree = amount !== null && amount === 0;

  return (
    <div className="bg-white rounded-[10px] border border-border overflow-hidden px-6 sm:px-8 py-6 w-full max-w-md text-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
          <CheckCircle size={32} className="text-success" />
        </div>
        <h1 className="text-xl font-black">Payment Successful</h1>
        <p className="text-sm text-text-secondary">
          Your guest parking payment has been confirmed. The guest&apos;s stay is now fully paid.
        </p>
        <div className="bg-surface-container rounded-[10px] p-4 w-full flex flex-col gap-2">
          {billing && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Total nights</span>
                <span className="font-medium">{billing.totalNights}</span>
              </div>
              {billing.guestFreePassNights > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Vehicle free night</span>
                  <span className="font-medium text-green-600">-{billing.guestFreePassNights}</span>
                </div>
              )}
              {passesFromBalance > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Passes from balance</span>
                  <span className="font-medium text-green-600">-{passesFromBalance}</span>
                </div>
              )}
              {billing.billableNights > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Billable nights</span>
                  <span className="font-medium">{billing.billableNights} × $5.00</span>
                </div>
              )}
              <div className="border-t border-border my-1" />
            </>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Amount</span>
            <span className="font-bold">
              {amount !== null
                ? isFree
                  ? "Free — covered by passes"
                  : `$${amount.toFixed(2)}`
                : "—"}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Status</span>
            <span className="text-success font-medium">Paid</span>
          </div>
        </div>
        <Link href="/dashboard" className="w-full">
          <Button className="w-full">Back to Dashboard</Button>
        </Link>
      </div>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={<div className="text-white">Loading...</div>}>
      <PaymentSuccessContent />
    </Suspense>
  );
}
