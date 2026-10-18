"use client";

import { useState, useEffect } from "react";
import { useGuestStore, type Guest } from "@/stores/guestStore";
import SearchBar from "@/components/ui/SearchBar";
import StatsCard from "@/components/ui/StatsCard";
import TabBar from "@/components/ui/TabBar";
import GuestCard from "@/components/shared/GuestCard";
import BottomSheet from "@/components/ui/BottomSheet";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import ShowMoreButton from "@/components/ui/ShowMoreButton";
import { GuestCardSkeleton } from "@/components/ui/Skeleton";
import { Timer, CalendarClock, Hourglass, History, Car } from "lucide-react";
import { isBefore, isAfter, isToday, startOfDay, format, differenceInDays } from "date-fns";

type HistoryTab = "active" | "upcoming" | "previous";

function categorize(guest: Guest): HistoryTab {
  const now = startOfDay(new Date());
  if (guest.status === "cancelled" || guest.status === "expired") return "previous";
  if (guest.status === "paid" && isBefore(guest.endDate, now) && !isToday(guest.endDate)) return "previous";

  const isActive =
    (isBefore(guest.startDate, now) || isToday(guest.startDate)) &&
    (isAfter(guest.endDate, now) || isToday(guest.endDate));
  if (isActive) return "active";

  if (isAfter(guest.startDate, now)) return "upcoming";

  return "previous";
}

export default function AdminHistory() {
  const { guests, search, setSearch, fetchGuests, isLoading, hasMore, isLoadingMore, fetchMoreGuests } = useGuestStore();
  const [tab, setTab] = useState<HistoryTab>("active");
  const [selected, setSelected] = useState<Guest | null>(null);

  useEffect(() => { fetchGuests(); }, [fetchGuests]);

  const q = search.toLowerCase();
  const filtered = guests.filter(
    (g) =>
      !q ||
      g.name.toLowerCase().includes(q) ||
      g.plate.toLowerCase().includes(q) ||
      g.vehicle.toLowerCase().includes(q) ||
      g.unit.toLowerCase().includes(q)
  );

  const categorized = {
    active: filtered.filter((g) => categorize(g) === "active"),
    upcoming: filtered.filter((g) => categorize(g) === "upcoming"),
    previous: filtered.filter((g) => categorize(g) === "previous"),
  };

  const tabs = [
    { key: "active", label: "Active", icon: Timer, count: categorized.active.length },
    { key: "upcoming", label: "Upcoming", icon: CalendarClock, count: categorized.upcoming.length },
    { key: "previous", label: "Previous", icon: Hourglass, count: categorized.previous.length },
  ];

  const displayGuests = categorized[tab];

  return (
    <div className="flex flex-col gap-4 py-4">
      <div>
        <h1 className="text-xl font-bold">Guest History</h1>
        <p className="text-sm text-text-secondary mt-0.5">Active, upcoming, and previous guest stays</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatsCard title="Upcoming" value={categorized.upcoming.length} accent="warning" icon={CalendarClock} />
        <StatsCard title="Active" value={categorized.active.length} accent="success" icon={Timer} />
        <StatsCard title="Previous" value={categorized.previous.length} accent="primary" icon={Hourglass} />
        <StatsCard title="Total" value={guests.length} accent="info" icon={History} />
      </div>

      <SearchBar value={search} onChange={setSearch} placeholder="Search by name, unit, vehicle, or plate..." />
      <TabBar tabs={tabs} active={tab} onChange={(k) => setTab(k as HistoryTab)} />

      {isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <GuestCardSkeleton key={i} />)}</div>
      ) : displayGuests.length === 0 ? (
        <EmptyState
          title={`No ${tab} Guests`}
          description={`There are no ${tab} guests at the moment`}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {displayGuests.map((guest) => (
            <GuestCard key={guest.id} guest={guest} onTap={setSelected} />
          ))}
        </div>
      )}

      <ShowMoreButton hasMore={hasMore} isLoading={isLoadingMore} onLoadMore={fetchMoreGuests} loadedCount={guests.length} />

      {/* Detail sheet */}
      <BottomSheet open={!!selected} onClose={() => setSelected(null)} title="Guest Details">
        {selected && (
          <div className="flex flex-col gap-3">
            {[
              { label: "Name", value: selected.name },
              { label: "Unit", value: selected.unit },
              { label: "Vehicle", value: selected.vehicle },
              { label: "Plate", value: selected.plate },
              { label: "Dates", value: `${format(selected.startDate, "MM/dd/yyyy")} – ${format(selected.endDate, "MM/dd/yyyy")}` },
              { label: "Duration", value: `${Math.max(1, differenceInDays(selected.endDate, selected.startDate))} night(s)` },
            ].map((row) => (
              <div key={row.label} className="flex justify-between text-sm">
                <span className="text-text-secondary">{row.label}</span>
                <span className="font-medium">{row.value || "—"}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm items-center">
              <span className="text-text-secondary">Status</span>
              <Badge variant={
                selected.status === "active" || selected.status === "approved" ? "success" :
                selected.status === "needs_payment" ? "danger" :
                selected.status === "pending" ? "warning" : "neutral"
              }>
                {selected.status.replace("_", " ")}
              </Badge>
            </div>
            {selected.amountDue > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Amount</span>
                <span className="font-bold">${selected.amountDue.toFixed(2)}</span>
              </div>
            )}
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
