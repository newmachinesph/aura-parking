"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAuthStore } from "@/stores/authStore";
import { apiFetch, ApiError } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import BottomSheet from "@/components/ui/BottomSheet";
import StripeCheckoutForm from "@/components/shared/StripeCheckout";
import Skeleton from "@/components/ui/Skeleton";
import { Ticket, Gift, CheckCircle, XCircle } from "lucide-react";

interface PassBalance {
  bonusPasses: number;
  monthlyFreeTotal: number;
  monthlyFreeUsed: number;
  monthlyFreeRemaining: number;
}

const BUNDLES = [
  {
    type: "3-pass" as const,
    passes: 3,
    originalCents: 1500,
    priceCents: 1275,
    discount: "15% off",
  },
  {
    type: "5-pass" as const,
    passes: 5,
    originalCents: 2500,
    priceCents: 2000,
    discount: "20% off",
  },
];

function formatDollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function PassesContent() {
  const searchParams = useSearchParams();
  const residentId = useAuthStore((s) => s.session?.user.residentId);

  const [balance, setBalance] = useState<PassBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmResult, setConfirmResult] = useState<{ passCount: number; bonusBalance: number } | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  const loadBalance = useCallback(async () => {
    if (!residentId) return;
    try {
      setError(null);
      const data = await apiFetch<PassBalance>(`/api/residents/${residentId}/pass-balance`);
      setBalance(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load balance");
    } finally {
      setLoading(false);
    }
  }, [residentId]);

  // Confirm purchase on return from Stripe
  useEffect(() => {
    const sessionId = searchParams.get("session_id");
    if (!sessionId) return;

    (async () => {
      try {
        const result = await apiFetch<{ passCount: number; bonusBalance: number }>(
          "/api/pass-bundles/confirm",
          { method: "POST", body: JSON.stringify({ session_id: sessionId }) }
        );
        setConfirmResult(result);
        // PAY-01 fix: Update balance immediately from confirm result to prevent
        // flicker between stale loadBalance() and the confirm response
        setBalance((prev) => prev ? { ...prev, bonusPasses: result.bonusBalance } : prev);
        // Then do a full refresh for the complete picture
        loadBalance();
      } catch (err) {
        setConfirmError(err instanceof ApiError ? err.message : "Failed to confirm purchase");
      }
      // Clean URL
      window.history.replaceState({}, "", "/dashboard/passes");
    })();
  }, [searchParams, loadBalance]);

  // Check for cancellation
  useEffect(() => {
    if (searchParams.get("cancelled") === "1") {
      setCancelled(true);
      window.history.replaceState({}, "", "/dashboard/passes");
    }
  }, [searchParams]);

  useEffect(() => { loadBalance(); }, [loadBalance]);

  const [checkoutBundle, setCheckoutBundle] = useState<string | null>(null);
  const checkoutBody = useMemo(
    () => (checkoutBundle ? { bundleType: checkoutBundle } : { bundleType: "" }),
    [checkoutBundle]
  );

  const handleBuy = (bundleType: string) => {
    setCheckoutBundle(bundleType);
  };

  return (
    <div className="flex flex-col gap-4 py-4">
      <h1 className="text-xl font-bold">Passes</h1>

      {/* Success banner */}
      {confirmResult && (
        <div className="flex items-center gap-2 p-3 bg-green-50 rounded-[10px] border border-green-200">
          <CheckCircle size={18} className="text-green-600 shrink-0" />
          <p className="text-sm font-medium text-green-700">
            {confirmResult.passCount} bonus passes added! You now have {confirmResult.bonusBalance} bonus passes.
          </p>
        </div>
      )}

      {/* Confirm error */}
      {confirmError && (
        <div className="flex items-center gap-2 p-3 bg-red-50 rounded-[10px] border border-red-200">
          <XCircle size={18} className="text-red-600 shrink-0" />
          <p className="text-sm font-medium text-red-700">{confirmError}</p>
        </div>
      )}

      {/* Cancelled banner */}
      {cancelled && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-[10px] border border-amber-200">
          <XCircle size={18} className="text-amber-600 shrink-0" />
          <p className="text-sm font-medium text-amber-700">Purchase cancelled</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{error}</div>
      )}

      {/* Balance card */}
      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Ticket size={18} className="text-primary-500" />
            <p className="font-semibold text-sm">Your Pass Balance</p>
          </div>
          {loading ? (
            <div className="grid grid-cols-2 gap-3"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
          ) : balance ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col items-center p-3 bg-primary-50 rounded-[10px]">
                <p className="text-2xl font-bold text-primary-600">{balance.bonusPasses}</p>
                <p className="text-xs text-text-secondary">Bonus Passes</p>
              </div>
              <div className="flex flex-col items-center p-3 bg-green-50 rounded-[10px]">
                <p className="text-2xl font-bold text-green-600">{balance.monthlyFreeRemaining}</p>
                <p className="text-xs text-text-secondary">Free Nights</p>
                <p className="text-[10px] text-text-secondary mt-0.5">
                  {balance.monthlyFreeUsed > 0
                    ? `${balance.monthlyFreeUsed} used of ${balance.monthlyFreeTotal}`
                    : `${balance.monthlyFreeTotal} accumulated`}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      {/* Bundle cards */}
      <div className="flex items-center gap-2">
        <Gift size={18} className="text-primary-500" />
        <p className="font-semibold text-sm">Buy Pass Bundles</p>
      </div>
      <p className="text-xs text-text-secondary -mt-2">
        Save on guest parking with discounted pass bundles. Passes are applied automatically when guests visit.
      </p>

      <div className="flex flex-col gap-3">
        {BUNDLES.map((bundle) => (
          <Card key={bundle.type}>
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <p className="font-bold">{bundle.passes}-Pass Bundle</p>
                  <Badge variant="success">{bundle.discount}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-primary-600">{formatDollars(bundle.priceCents)}</span>
                  <span className="text-sm text-text-secondary line-through">{formatDollars(bundle.originalCents)}</span>
                </div>
                <p className="text-xs text-text-secondary">{formatDollars(bundle.priceCents / bundle.passes)}/pass</p>
              </div>
              <Button
                className="px-4 min-h-10 text-sm"
                onClick={() => handleBuy(bundle.type)}
              >
                Buy
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {/* Inline Stripe Checkout */}
      <BottomSheet
        open={!!checkoutBundle}
        onClose={() => setCheckoutBundle(null)}
        title="Complete Purchase"
      >
        {checkoutBundle && (
          <StripeCheckoutForm
            endpoint="/api/checkout-session/bundle"
            body={checkoutBody}
          />
        )}
      </BottomSheet>
    </div>
  );
}

export default function PassesPage() {
  return (
    <Suspense fallback={<div className="flex flex-col gap-4 py-4"><h1 className="text-xl font-bold">Passes</h1><p className="text-sm text-text-secondary text-center py-8">Loading...</p></div>}>
      <PassesContent />
    </Suspense>
  );
}
