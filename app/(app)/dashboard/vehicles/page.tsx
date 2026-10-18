"use client";

import { useState, useEffect } from "react";
import { useGuestStore, type Guest } from "@/stores/guestStore";
import { useAuthStore } from "@/stores/authStore";
import SearchBar from "@/components/ui/SearchBar";
import VehicleCard from "@/components/shared/VehicleCard";
import BottomSheet from "@/components/ui/BottomSheet";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import { DollarSign, Car } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { RATE_PER_DAY } from "@/lib/constants";
import { VehicleCardSkeleton } from "@/components/ui/Skeleton";
import type { Vehicle } from "@/stores/parkingStore";

export default function ResidentVehicles() {
  const session = useAuthStore((s) => s.session);
  const { guests, fetchGuests, isLoading } = useGuestStore();
  const residentId = session?.user.residentId;
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Vehicle | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<Guest | null>(null);

  useEffect(() => {
    if (residentId) fetchGuests(residentId);
  }, [residentId, fetchGuests]);

  const q = search.toLowerCase();

  // Derive vehicles from guest list — only show approved/active/paid stays
  const vehicles: Vehicle[] = guests
    .filter((g) => g.status === "active" || g.status === "approved" || g.status === "paid" || g.status === "needs_payment")
    .map((g) => ({
      id: g.id,
      name: g.name,
      unit: g.unit,
      plate: g.plate,
      vehicle: g.vehicle,
      startDate: g.startDate,
      endDate: g.endDate,
      status: g.status === "expired" ? "expired" as const : "active" as const,
    }));

  const filtered = vehicles.filter(
    (v) =>
      !q ||
      v.name.toLowerCase().includes(q) ||
      v.plate.toLowerCase().includes(q) ||
      v.vehicle.toLowerCase().includes(q)
  );

  // Payment records — all guests with billing info
  const paymentRecords = guests.filter(
    (g) => g.status === "paid" || g.status === "needs_payment" || g.status === "approved" || g.status === "active"
  );
  const filteredPayments = paymentRecords.filter(
    (g) =>
      !q ||
      g.name.toLowerCase().includes(q) ||
      g.plate.toLowerCase().includes(q) ||
      g.vehicle.toLowerCase().includes(q)
  );

  return (
    <div className="flex flex-col gap-4 py-4">
      <h1 className="text-xl font-bold">Vehicles</h1>

      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Search plates, vehicles..."
      />

      {isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 3 }).map((_, i) => <VehicleCardSkeleton key={i} />)}</div>
      ) : filtered.length === 0 && filteredPayments.length === 0 ? (
        <EmptyState title="No vehicles" description="Guest vehicles will appear here" />
      ) : (
        <>
          {/* Active Vehicles */}
          {filtered.length > 0 && (
            <div className="flex flex-col gap-2">
              {filtered.map((v) => (
                <VehicleCard key={v.id} vehicle={v} onClick={setSelected} />
              ))}
            </div>
          )}

          {/* Payment Records */}
          {filteredPayments.length > 0 && (
            <div className="flex flex-col gap-2 mt-2">
              <div className="flex items-center gap-2">
                <DollarSign size={16} className="text-text-secondary" />
                <p className="text-sm font-semibold">Payment Records</p>
              </div>
              {filteredPayments.map((g) => {
                const isPaid = g.status === "paid";
                const totalNights = Math.max(1, differenceInDays(g.endDate, g.startDate));
                return (
                  <Card key={`pay-${g.id}`} onClick={() => setSelectedPayment(g)}>
                    <div className="flex items-center gap-3">
                      <Car size={16} className="text-text-secondary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{g.vehicle || g.plate}</p>
                        <p className="text-xs text-text-secondary">{g.name} · {totalNights} night{totalNights !== 1 ? "s" : ""}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-bold">{g.amountDue > 0 ? `$${g.amountDue.toFixed(2)}` : "Free"}</span>
                        <Badge variant={isPaid || g.amountDue === 0 ? "success" : "warning"}>
                          {isPaid ? "Paid" : g.amountDue === 0 ? "Covered" : "Unsettled"}
                        </Badge>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Vehicle Detail Sheet */}
      <BottomSheet open={!!selected} onClose={() => setSelected(null)} title="Vehicle Details">
        {selected && (
          <div className="flex flex-col gap-2">
            {[
              { label: "Plate", value: selected.plate },
              { label: "Vehicle", value: selected.vehicle },
              { label: "Guest", value: selected.name },
              { label: "Unit", value: selected.unit },
              { label: "Status", value: selected.status },
            ].map((row) => (
              <div key={row.label} className="flex justify-between text-sm">
                <span className="text-text-secondary">{row.label}</span>
                <span className="font-medium capitalize">{row.value}</span>
              </div>
            ))}
          </div>
        )}
      </BottomSheet>

      {/* Payment Detail Sheet */}
      <BottomSheet open={!!selectedPayment} onClose={() => setSelectedPayment(null)} title="Payment Details">
        {selectedPayment && (() => {
          const totalNights = Math.max(1, differenceInDays(selectedPayment.endDate, selectedPayment.startDate));
          const isPaid = selectedPayment.status === "paid";
          return (
            <div className="flex flex-col gap-2">
              {[
                { label: "Guest", value: selectedPayment.name },
                { label: "Unit", value: selectedPayment.unit },
                { label: "Vehicle", value: selectedPayment.vehicle },
                { label: "Plate", value: selectedPayment.plate },
                { label: "Dates", value: `${format(selectedPayment.startDate, "MM/dd")} – ${format(selectedPayment.endDate, "MM/dd")}` },
                { label: "Duration", value: `${totalNights} night${totalNights !== 1 ? "s" : ""}` },
              ].map((row) => (
                <div key={row.label} className="flex justify-between text-sm">
                  <span className="text-text-secondary">{row.label}</span>
                  <span className="font-medium">{row.value || "—"}</span>
                </div>
              ))}
              {selectedPayment.guestFreePassNights > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Vehicle free night</span>
                  <span className="font-medium text-success">-{selectedPayment.guestFreePassNights}</span>
                </div>
              )}
              {(selectedPayment.freePassUsed - (selectedPayment.guestFreePassNights || 0)) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Passes from balance</span>
                  <span className="font-medium text-success">-{selectedPayment.freePassUsed - (selectedPayment.guestFreePassNights || 0)} night{(selectedPayment.freePassUsed - (selectedPayment.guestFreePassNights || 0)) !== 1 ? "s" : ""}</span>
                </div>
              )}
              {selectedPayment.billableNights > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Billable</span>
                  <span className="font-medium">{selectedPayment.billableNights} × ${RATE_PER_DAY}</span>
                </div>
              )}
              <div className="flex justify-between text-sm border-t border-border pt-2 mt-1">
                <span className="font-semibold">Total</span>
                <span className="font-bold">{selectedPayment.amountDue > 0 ? `$${selectedPayment.amountDue.toFixed(2)}` : "Free"}</span>
              </div>
              <div className="flex justify-between text-sm items-center mt-1">
                <span className="text-text-secondary">Status</span>
                <Badge variant={isPaid || selectedPayment.amountDue === 0 ? "success" : "warning"}>
                  {isPaid ? "Paid" : selectedPayment.amountDue === 0 ? "Covered" : "Unsettled"}
                </Badge>
              </div>
            </div>
          );
        })()}
      </BottomSheet>
    </div>
  );
}
