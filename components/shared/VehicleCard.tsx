"use client";

import { CarFront, Trash2 } from "lucide-react";
import Badge from "@/components/ui/Badge";
import { format } from "date-fns";
import type { Vehicle } from "@/stores/parkingStore";

const COLOR_MAP: Record<string, string> = {
  active: "#27ae60",
  expired: "#f39c12",
  unauthorized: "#e74c3c",
};

const BADGE_MAP: Record<string, { label: string; variant: "success" | "warning" | "danger" }> = {
  active: { label: "Active", variant: "success" },
  expired: { label: "Expired", variant: "warning" },
  unauthorized: { label: "Unauthorized", variant: "danger" },
};

interface VehicleCardProps {
  vehicle: Vehicle;
  onClick?: (vehicle: Vehicle) => void;
  onDelete?: (vehicle: Vehicle) => void;
}

export default function VehicleCard({ vehicle, onClick, onDelete }: VehicleCardProps) {
  const badge = BADGE_MAP[vehicle.status];
  const color = COLOR_MAP[vehicle.status];

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-[10px] bg-surface-container border-l-[3px] active:scale-[0.98] transition-all cursor-pointer"
      style={{ borderLeftColor: color }}
      onClick={() => onClick?.(vehicle)}
    >
      {vehicle.photoUrl ? (
        <img src={vehicle.photoUrl} alt={vehicle.plate} className="w-10 h-10 rounded-full object-cover shrink-0 border border-border" />
      ) : (
        <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shrink-0 border border-border">
          <CarFront size={20} color={color} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm truncate">
          {vehicle.plate} — {vehicle.vehicle}
        </p>
        <p className="text-xs text-text-secondary">
          {vehicle.name} · {vehicle.unit}
        </p>
        {vehicle.startDate && vehicle.endDate && (
          <p className="text-[11px] text-text-secondary">
            {format(vehicle.startDate, "MM/dd")} – {format(vehicle.endDate, "MM/dd")}
          </p>
        )}
        {vehicle.location && (
          <p className="text-[11px] text-text-secondary">{vehicle.location}</p>
        )}
      </div>
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(vehicle); }}
          className="p-2 rounded-lg hover:bg-red-50 transition-colors text-text-secondary hover:text-red-500 cursor-pointer shrink-0"
          title="Delete"
        >
          <Trash2 size={16} />
        </button>
      )}
      <span className="hidden sm:inline-flex">
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </span>
    </div>
  );
}
