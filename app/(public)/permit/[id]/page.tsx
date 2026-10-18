"use client";

import { useEffect, useState, Suspense, use } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle, Loader2, AlertTriangle, Car, Calendar, Building2, CreditCard } from "lucide-react";

interface PermitData {
  id: number;
  status: string;
  guestName: string;
  unitNumber: string;
  vehiclePlate: string;
  vehicleDesc: string;
  startDate: string;
  endDate: string;
  billableNights: number;
  amountCents: number;
  passesApplied: number;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function PermitContent({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [loading, setLoading] = useState(true);
  const [permit, setPermit] = useState<PermitData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = token
      ? `/api/guest-stays/${id}/permit?token=${encodeURIComponent(token)}`
      : `/api/guest-stays/${id}/permit`;

    fetch(url, { credentials: "include" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load permit");
        setPermit(data);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load permit");
      })
      .finally(() => setLoading(false));
  }, [id, token]);

  if (loading) {
    return (
      <div className="bg-white rounded-[10px] border border-border overflow-hidden px-6 sm:px-8 py-6 w-full max-w-md text-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={32} className="animate-spin text-primary-500" />
          <p className="text-sm text-text-secondary">Loading permit...</p>
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
          <h1 className="text-xl font-black">Permit Not Found</h1>
          <p className="text-sm text-text-secondary">{error}</p>
        </div>
      </div>
    );
  }

  if (!permit) {
    return null;
  }

  const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    APPROVED: { label: "Approved", color: "text-success", bg: "bg-green-100" },
    PAID: { label: "Paid", color: "text-success", bg: "bg-green-100" },
    NEEDS_PAYMENT: { label: "Needs Payment", color: "text-warning", bg: "bg-amber-100" },
  };

  const status = statusConfig[permit.status] || { label: permit.status, color: "text-text-secondary", bg: "bg-gray-100" };

  return (
    <div className="bg-white rounded-[10px] border border-border overflow-hidden w-full max-w-md">
      {/* Header */}
      <div className="bg-gradient-to-br from-primary-500 to-primary-600 px-6 py-8 text-center text-white">
        <h1 className="text-2xl font-black tracking-wider mb-1">AURA APACHE</h1>
        <p className="text-sm opacity-90">Digital Parking Permit</p>
      </div>

      {/* Status Badge */}
      <div className="flex justify-center -mt-4">
        <div className={`${status.bg} px-4 py-2 rounded-full`}>
          <span className={`text-sm font-bold ${status.color} uppercase tracking-wide`}>{status.label}</span>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-6">
        <div className="text-center mb-6">
          <h2 className="text-lg font-bold text-text-primary">Guest Parking Permit</h2>
          <p className="text-sm text-text-secondary">Keep this permit available while parked</p>
        </div>

        <div className="space-y-4">
          {/* Unit */}
          <div className="bg-surface-container rounded-[10px] p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                <Building2 size={20} className="text-primary-500" />
              </div>
              <div>
                <p className="text-xs text-text-secondary uppercase tracking-wide font-medium">Unit</p>
                <p className="font-bold text-text-primary">{permit.unitNumber}</p>
              </div>
            </div>
          </div>

          {/* Vehicle */}
          <div className="bg-surface-container rounded-[10px] p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                <Car size={20} className="text-primary-500" />
              </div>
              <div>
                <p className="text-xs text-text-secondary uppercase tracking-wide font-medium">Vehicle</p>
                <p className="font-bold text-text-primary">{permit.vehiclePlate}</p>
                {permit.vehicleDesc && (
                  <p className="text-sm text-text-secondary">{permit.vehicleDesc}</p>
                )}
              </div>
            </div>
          </div>

          {/* Stay Period */}
          <div className="bg-surface-container rounded-[10px] p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                <Calendar size={20} className="text-primary-500" />
              </div>
              <div>
                <p className="text-xs text-text-secondary uppercase tracking-wide font-medium">Valid Period</p>
                <p className="font-bold text-text-primary">
                  {formatDate(permit.startDate)} - {formatDate(permit.endDate)}
                </p>
              </div>
            </div>
          </div>

          {/* Payment Status */}
          {permit.status === "PAID" && (
            <div className="bg-green-50 border border-green-200 rounded-[10px] p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle size={20} className="text-success" />
                </div>
                <div>
                  <p className="text-xs text-success uppercase tracking-wide font-medium">Payment Status</p>
                  <p className="font-bold text-success">Fully Paid</p>
                </div>
              </div>
            </div>
          )}

          {permit.status === "NEEDS_PAYMENT" && (
            <div className="bg-amber-50 border border-amber-200 rounded-[10px] p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                  <CreditCard size={20} className="text-warning" />
                </div>
                <div>
                  <p className="text-xs text-warning uppercase tracking-wide font-medium">Payment Required</p>
                  <p className="font-bold text-warning">${(permit.amountCents / 100).toFixed(2)}</p>
                </div>
              </div>
            </div>
          )}

          {permit.status === "APPROVED" && permit.passesApplied > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-[10px] p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle size={20} className="text-success" />
                </div>
                <div>
                  <p className="text-xs text-success uppercase tracking-wide font-medium">Covered by Passes</p>
                  <p className="font-bold text-success">{permit.passesApplied} night{permit.passesApplied !== 1 ? "s" : ""} covered</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Guest Info */}
        <div className="mt-6 pt-4 border-t border-border text-center">
          <p className="text-xs text-text-secondary">Guest: {permit.guestName}</p>
        </div>
      </div>
    </div>
  );
}

export default function PermitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  return (
    <Suspense fallback={
      <div className="bg-white rounded-[10px] border border-border overflow-hidden px-6 py-6 w-full max-w-md text-center">
        <Loader2 size={32} className="animate-spin text-primary-500 mx-auto" />
      </div>
    }>
      <PermitContent id={id} />
    </Suspense>
  );
}
