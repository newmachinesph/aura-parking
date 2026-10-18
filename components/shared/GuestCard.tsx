"use client";

import Badge from "@/components/ui/Badge";
import { format } from "date-fns";
import type { Guest } from "@/stores/guestStore";

const STATUS_MAP: Record<string, { label: string; variant: "success" | "success-subtle" | "warning" | "danger" | "info" | "neutral" }> = {
  approved: { label: "Approved", variant: "success-subtle" },
  active: { label: "Active", variant: "success" },
  paid: { label: "Paid", variant: "info" },
  pending: { label: "Pending", variant: "warning" },
  needs_payment: { label: "Payment Due", variant: "danger" },
  cancelled: { label: "Cancelled", variant: "neutral" },
  expired: { label: "Expired", variant: "neutral" },
};

const BORDER_COLORS: Record<string, string> = {
  success: "#27ae60",
  "success-subtle": "#6ee7b7",
  warning: "#f39c12",
  danger: "#e74c3c",
  info: "#3498db",
  neutral: "#d1d5db",
};

interface GuestCardProps {
  guest: Guest;
  onTap?: (guest: Guest) => void;
  onPay?: (guest: Guest) => void;
  /** Estimated cost for pending guests (when stay exceeds available passes) */
  estimatedCost?: number;
  /** Desktop-only quick action icons */
  desktopActions?: React.ReactNode;
}

export default function GuestCard({ guest, onTap, onPay, estimatedCost, desktopActions }: GuestCardProps) {
  const status = STATUS_MAP[guest.status] ?? { label: guest.status, variant: "neutral" as const };
  const showCost = guest.status === "pending" && estimatedCost && estimatedCost > 0;

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-[10px] bg-surface-container border-l-[3px] active:scale-[0.98] transition-all cursor-pointer"
      style={{ borderLeftColor: BORDER_COLORS[status.variant] }}
      onClick={() => onTap?.(guest)}
    >
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm truncate">{guest.name}</p>
        <p className="text-xs text-text-secondary truncate">{guest.vehicle}</p>
        <p className="text-[11px] text-text-secondary">
          {format(guest.startDate, "MM/dd")} – {format(guest.endDate, "MM/dd")} · {guest.plate}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        {guest.status === "needs_payment" && guest.amountDue > 0 ? (
          <button
            onClick={(e) => { e.stopPropagation(); onPay?.(guest); }}
            className="px-3 py-1.5 rounded-lg bg-danger text-white text-xs font-semibold cursor-pointer active:scale-95 transition-transform"
          >
            Pay ${guest.amountDue.toFixed(2)}
          </button>
        ) : (
          <>
            <Badge variant={status.variant}>{status.label}</Badge>
            {showCost && (
              <span className="text-[11px] font-semibold text-amber-600">
                ~${estimatedCost.toFixed(2)}
              </span>
            )}
          </>
        )}
      </div>
      {desktopActions && (
        <div className="hidden lg:flex items-center gap-0.5 ml-1">
          {desktopActions}
        </div>
      )}
    </div>
  );
}
