"use client";

import { useState, useEffect, useCallback } from "react";
import { useGuestStore, type Guest } from "@/stores/guestStore";
import StatsCard from "@/components/ui/StatsCard";
import SearchBar from "@/components/ui/SearchBar";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import BottomSheet from "@/components/ui/BottomSheet";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import EmptyState from "@/components/ui/EmptyState";
import ShowMoreButton from "@/components/ui/ShowMoreButton";
import Skeleton from "@/components/ui/Skeleton";
import TabBar from "@/components/ui/TabBar";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { apiFetch, ApiError } from "@/lib/api";
import { getInitials } from "@/lib/helpers";
import {
  Users, Building, Briefcase, Plus, Pencil, Trash2, Car,
  User, Mail, Lock, Home,
} from "lucide-react";
import { isBefore, isAfter, isToday, startOfDay, differenceInDays, format } from "date-fns";
import { useToast } from "@/components/ui/Toast";

type ViewMode = "residents" | "units" | "guests";

// ─── Resident types & helpers ───────────────────────────────────────────
interface Resident {
  id: number;
  unit_number: string;
  full_name: string;
  email: string;
  status: string;
  is_primary_contact: boolean;
  created_at: string;
}

interface GuestStay {
  id: number;
  guest_name: string;
  vehicle_plate: string;
  vehicle_desc: string;
  start_date: string;
  end_date: string;
  status: string;
}

type HistoryTab = "current" | "upcoming" | "previous";

function categorizeStay(stay: GuestStay) {
  const now = startOfDay(new Date());
  const start = new Date(stay.start_date);
  const end = new Date(stay.end_date);
  const status = stay.status.toUpperCase();
  if (status === "CANCELLED") return "previous";
  const isActive =
    (isBefore(start, now) || isToday(start)) &&
    (isAfter(end, now) || isToday(end));
  if (isActive && status !== "CANCELLED") return "current";
  if (isAfter(start, now)) return "upcoming";
  return "previous";
}

// ─── Unit type ──────────────────────────────────────────────────────────
interface Unit {
  id: number;
  unit_number: string;
  building_code: string | null;
  active_residents: number;
  total_residents: number;
  created_at: string;
}

export default function AdminDashboard() {
  const [viewMode, setViewMode] = useState<ViewMode>("residents");
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  // ─── Residents state ──────────────────────────────────────────────
  const [residents, setResidents] = useState<Resident[]>([]);
  const [residentsLoading, setResidentsLoading] = useState(true);
  const [residentsHasMore, setResidentsHasMore] = useState(false);
  const [residentsNextCursor, setResidentsNextCursor] = useState<number | null>(null);
  const [residentsLoadingMore, setResidentsLoadingMore] = useState(false);

  const [selectedResident, setSelectedResident] = useState<Resident | null>(null);
  const [historyTab, setHistoryTab] = useState<HistoryTab>("current");
  const [guestStays, setGuestStays] = useState<GuestStay[]>([]);
  const [staysLoading, setStaysLoading] = useState(false);

  const [editingResident, setEditingResident] = useState<Resident | null>(null);
  const [editResidentForm, setEditResidentForm] = useState({ fullName: "", email: "", unitNumber: "" });
  const [editResidentSubmitting, setEditResidentSubmitting] = useState(false);
  const [editResidentError, setEditResidentError] = useState<string | null>(null);

  const [showAddResident, setShowAddResident] = useState(false);
  const [addResidentForm, setAddResidentForm] = useState({ fullName: "", email: "", password: "", unitNumber: "" });
  const [addResidentError, setAddResidentError] = useState<string | null>(null);
  const [addResidentSubmitting, setAddResidentSubmitting] = useState(false);

  // ─── Units state ──────────────────────────────────────────────────
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(true);
  const [unitsHasMore, setUnitsHasMore] = useState(false);
  const [unitsNextCursor, setUnitsNextCursor] = useState<number | null>(null);
  const [unitsLoadingMore, setUnitsLoadingMore] = useState(false);

  const [showAddUnit, setShowAddUnit] = useState(false);
  const [addUnitForm, setAddUnitForm] = useState({ unitNumber: "", buildingCode: "" });
  const [addUnitError, setAddUnitError] = useState<string | null>(null);
  const [addUnitSubmitting, setAddUnitSubmitting] = useState(false);

  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null);

  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [editUnitForm, setEditUnitForm] = useState({ unitNumber: "", buildingCode: "" });
  const [editUnitError, setEditUnitError] = useState<string | null>(null);
  const [editUnitSubmitting, setEditUnitSubmitting] = useState(false);

  // ─── Guests state (all guests) ────────────────────────────────────
  const {
    guests, fetchGuests, isLoading: guestsLoading, hasMore: guestsHasMore,
    isLoadingMore: guestsLoadingMore, fetchMoreGuests,
  } = useGuestStore();

  // ─── Total counts (from DB, not array lengths) ──────────────────
  const [totalCounts, setTotalCounts] = useState({ total_residents: 0, total_units: 0, total_guests: 0 });

  // ─── Shared ───────────────────────────────────────────────────────
  const [confirmAction, setConfirmAction] = useState<{ action: () => Promise<void>; title: string; description: string } | null>(null);

  // ─── Data loading ─────────────────────────────────────────────────
  const loadResidents = useCallback(async () => {
    try {
      const data = await apiFetch<{ residents: Resident[]; hasMore: boolean; nextCursor: number | null }>("/api/residents");
      setResidents(data.residents);
      setResidentsHasMore(data.hasMore ?? false);
      setResidentsNextCursor(data.nextCursor ?? null);
    } catch { /* silent */ }
    finally { setResidentsLoading(false); }
  }, []);

  const loadUnits = useCallback(async () => {
    try {
      const data = await apiFetch<{ units: Unit[]; hasMore: boolean; nextCursor: number | null }>("/api/admin/units");
      setUnits(data.units);
      setUnitsHasMore(data.hasMore ?? false);
      setUnitsNextCursor(data.nextCursor ?? null);
    } catch { /* silent */ }
    finally { setUnitsLoading(false); }
  }, []);

  const loadCounts = useCallback(async () => {
    try {
      const data = await apiFetch<{ total_residents: number; total_units: number; total_guests: number }>("/api/admin/counts");
      setTotalCounts(data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    loadResidents();
    loadUnits();
    fetchGuests();
    loadCounts();
  }, [loadResidents, loadUnits, fetchGuests, loadCounts]);

  // ─── Resident handlers ────────────────────────────────────────────
  const loadMoreResidents = useCallback(async () => {
    if (!residentsHasMore || residentsLoadingMore || !residentsNextCursor) return;
    setResidentsLoadingMore(true);
    try {
      const data = await apiFetch<{ residents: Resident[]; hasMore: boolean; nextCursor: number | null }>(
        `/api/residents?cursor=${residentsNextCursor}&limit=50`
      );
      setResidents((prev) => [...prev, ...data.residents]);
      setResidentsHasMore(data.hasMore ?? false);
      setResidentsNextCursor(data.nextCursor ?? null);
    } catch { /* silent */ }
    finally { setResidentsLoadingMore(false); }
  }, [residentsHasMore, residentsLoadingMore, residentsNextCursor]);

  const loadGuestStays = useCallback(async (residentId: number) => {
    setStaysLoading(true);
    try {
      const data = await apiFetch<{ stays: GuestStay[] }>(`/api/residents/${residentId}/guest-stays`);
      setGuestStays(data.stays || []);
    } catch { setGuestStays([]); }
    finally { setStaysLoading(false); }
  }, []);

  const handleSelectResident = (r: Resident) => {
    setSelectedResident(r);
    setHistoryTab("current");
    setGuestStays([]);
    loadGuestStays(r.id);
  };

  const openEditResident = (r: Resident) => {
    setEditingResident(r);
    setEditResidentForm({ fullName: r.full_name, email: r.email, unitNumber: r.unit_number });
    setEditResidentError(null);
    setSelectedResident(null);
  };

  const handleEditResident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingResident) return;
    setEditResidentSubmitting(true);
    setEditResidentError(null);
    try {
      await apiFetch(`/api/residents/${editingResident.id}`, {
        method: "PATCH",
        body: JSON.stringify({ fullName: editResidentForm.fullName, email: editResidentForm.email, unitNumber: editResidentForm.unitNumber }),
      });
      setResidents((prev) =>
        prev.map((r) => r.id === editingResident.id ? { ...r, full_name: editResidentForm.fullName, email: editResidentForm.email, unit_number: editResidentForm.unitNumber } : r)
      );
      setEditingResident(null);
      toast({ title: "Resident updated", variant: "success" });
    } catch (err) {
      setEditResidentError(err instanceof ApiError ? err.message : "Failed to update resident");
    } finally { setEditResidentSubmitting(false); }
  };

  const handleAddResident = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddResidentSubmitting(true);
    setAddResidentError(null);
    try {
      await apiFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ email: addResidentForm.email, password: addResidentForm.password, role: "resident", fullName: addResidentForm.fullName, unitNumber: addResidentForm.unitNumber }),
      });
      setShowAddResident(false);
      setAddResidentForm({ fullName: "", email: "", password: "", unitNumber: "" });
      loadResidents();
      toast({ title: "Resident created", variant: "success" });
    } catch (err) {
      setAddResidentError(err instanceof ApiError ? err.message : "Failed to create resident");
    } finally { setAddResidentSubmitting(false); }
  };

  const handleDeleteResident = async (r: Resident) => {
    try {
      await apiFetch(`/api/residents/${r.id}`, { method: "DELETE" });
      setResidents((prev) => prev.filter((res) => res.id !== r.id));
      setSelectedResident(null);
      toast({ title: "Resident deleted", variant: "success" });
    } catch (err) {
      toast({ title: "Failed to delete", description: err instanceof ApiError ? err.message : "Failed", variant: "error" });
    }
  };

  // ─── Unit handlers ────────────────────────────────────────────────
  const loadMoreUnits = useCallback(async () => {
    if (!unitsHasMore || unitsLoadingMore || !unitsNextCursor) return;
    setUnitsLoadingMore(true);
    try {
      const data = await apiFetch<{ units: Unit[]; hasMore: boolean; nextCursor: number | null }>(
        `/api/admin/units?cursor=${unitsNextCursor}&limit=50`
      );
      setUnits((prev) => [...prev, ...data.units]);
      setUnitsHasMore(data.hasMore ?? false);
      setUnitsNextCursor(data.nextCursor ?? null);
    } catch { /* silent */ }
    finally { setUnitsLoadingMore(false); }
  }, [unitsHasMore, unitsLoadingMore, unitsNextCursor]);

  const handleAddUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddUnitSubmitting(true);
    setAddUnitError(null);
    try {
      await apiFetch("/api/admin/units", {
        method: "POST",
        body: JSON.stringify({ unitNumber: addUnitForm.unitNumber, buildingCode: addUnitForm.buildingCode || undefined }),
      });
      setShowAddUnit(false);
      setAddUnitForm({ unitNumber: "", buildingCode: "" });
      loadUnits();
      toast({ title: "Unit created", variant: "success" });
    } catch (err) {
      setAddUnitError(err instanceof ApiError ? err.message : "Failed to create unit");
    } finally { setAddUnitSubmitting(false); }
  };

  const openEditUnit = (unit: Unit) => {
    setEditingUnit(unit);
    setEditUnitForm({ unitNumber: unit.unit_number, buildingCode: unit.building_code || "" });
    setEditUnitError(null);
  };

  const handleEditUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUnit) return;
    setEditUnitSubmitting(true);
    setEditUnitError(null);
    try {
      await apiFetch(`/api/admin/units/${editingUnit.id}`, {
        method: "PATCH",
        body: JSON.stringify({ unitNumber: editUnitForm.unitNumber, buildingCode: editUnitForm.buildingCode || null }),
      });
      setEditingUnit(null);
      loadUnits();
      toast({ title: "Unit updated", variant: "success" });
    } catch (err) {
      setEditUnitError(err instanceof ApiError ? err.message : "Failed to update unit");
    } finally { setEditUnitSubmitting(false); }
  };

  const handleDeleteUnit = async (unit: Unit) => {
    try {
      await apiFetch(`/api/admin/units/${unit.id}`, { method: "DELETE" });
      setUnits((prev) => prev.filter((u) => u.id !== unit.id));
      toast({ title: "Unit deleted", variant: "success" });
    } catch (err) {
      toast({ title: "Cannot delete unit", description: err instanceof ApiError ? err.message : "Failed to delete", variant: "error" });
    }
  };

  // ─── Filtering ────────────────────────────────────────────────────
  const q = search.toLowerCase();

  const filteredResidents = residents.filter(
    (r) => !q || r.full_name.toLowerCase().includes(q) || r.unit_number.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)
  );

  const filteredUnits = units
    .filter((u) => !q || u.unit_number.toLowerCase().includes(q) || (u.building_code || "").toLowerCase().includes(q))
    .sort((a, b) => Number(b.active_residents) - Number(a.active_residents));

  const filteredGuests = guests.filter(
    (g) => !q || g.name.toLowerCase().includes(q) || g.plate.toLowerCase().includes(q) || g.unit.toLowerCase().includes(q) || g.vehicle.toLowerCase().includes(q)
  );

  // ─── Resident detail sheet helpers ────────────────────────────────
  const categorized = {
    current: guestStays.filter((s) => categorizeStay(s) === "current"),
    upcoming: guestStays.filter((s) => categorizeStay(s) === "upcoming"),
    previous: guestStays.filter((s) => categorizeStay(s) === "previous"),
  };
  const historyTabs = [
    { key: "current", label: "Current", count: categorized.current.length },
    { key: "upcoming", label: "Upcoming", count: categorized.upcoming.length },
    { key: "previous", label: "Previous", count: categorized.previous.length },
  ];
  const activeStays = categorized[historyTab];

  // ─── Render helpers ───────────────────────────────────────────────
  const addButton = null;

  const isLoading = viewMode === "residents" ? residentsLoading : viewMode === "units" ? unitsLoading : guestsLoading;

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">
            {viewMode === "residents" ? "Residents" : viewMode === "units" ? "Units" : "Guests"}
          </h1>
          <p className="text-sm text-text-secondary mt-0.5">
            {viewMode === "residents" && "View all registered residents and their guest parking history."}
            {viewMode === "units" && "All registered units and their resident occupancy."}
            {viewMode === "guests" && "All guest stays across the property."}
          </p>
        </div>
        {addButton}
      </div>

      {/* Clickable stat cards */}
      <div className="grid grid-cols-3 gap-3">
        <StatsCard
          title="Residents"
          value={totalCounts.total_residents || residents.length}
          accent="primary"
          icon={Users}
          onClick={() => { setViewMode("residents"); setSearch(""); }}
          active={viewMode === "residents"}
        />
        <StatsCard
          title="Units"
          value={totalCounts.total_units || units.length}
          accent="success"
          icon={Building}
          onClick={() => { setViewMode("units"); setSearch(""); }}
          active={viewMode === "units"}
        />
        <StatsCard
          title="Guests"
          value={totalCounts.total_guests || guests.length}
          accent="info"
          icon={Briefcase}
          onClick={() => { setViewMode("guests"); setSearch(""); }}
          active={viewMode === "guests"}
        />
      </div>

      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder={
          viewMode === "residents" ? "Search by name, unit, or email..." :
          viewMode === "units" ? "Search by unit number..." :
          "Search by name, plate, vehicle, or unit..."
        }
      />

      {/* ─── Residents list ───────────────────────────────────────── */}
      {viewMode === "residents" && (
        <>
          {isLoading ? (
            <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : filteredResidents.length === 0 ? (
            <EmptyState title="No residents" description="No residents match your search" />
          ) : (
            <div className="flex flex-col gap-2">
              {filteredResidents.map((r) => (
                <Card key={r.id} onClick={() => handleSelectResident(r)}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary-50 flex items-center justify-center shrink-0">
                      <span className="text-primary-600 font-bold text-sm">{getInitials(r.full_name)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{r.full_name}</p>
                      <p className="text-xs text-text-secondary">{r.unit_number} · {r.email}</p>
                    </div>
                    <div className="hidden lg:flex items-center gap-0.5 ml-2">
                      <button title="Edit" onClick={(e) => { e.stopPropagation(); openEditResident(r); }} className="p-1.5 rounded-md hover:bg-primary-50 transition-colors text-text-secondary hover:text-primary-500 cursor-pointer"><Pencil size={15} /></button>
                      <button title="Delete" onClick={(e) => { e.stopPropagation(); setConfirmAction({ action: () => handleDeleteResident(r), title: "Delete Resident?", description: `Permanently delete ${r.full_name}?` }); }} className="p-1.5 rounded-md hover:bg-red-50 transition-colors text-text-secondary hover:text-red-500 cursor-pointer"><Trash2 size={15} /></button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
          <ShowMoreButton hasMore={residentsHasMore} isLoading={residentsLoadingMore} onLoadMore={loadMoreResidents} loadedCount={residents.length} />
        </>
      )}

      {/* ─── Units list ───────────────────────────────────────────── */}
      {viewMode === "units" && (
        <>
          {unitsLoading ? (
            <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : filteredUnits.length === 0 ? (
            <EmptyState title="No units" description="No units match your search" />
          ) : (
            <div className="flex flex-col gap-2">
              {filteredUnits.map((unit) => {
                const active = Number(unit.active_residents);
                const total = Number(unit.total_residents);
                return (
                  <Card key={unit.id} onClick={() => active > 0 ? setSelectedUnit(unit) : undefined}>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary-50 flex items-center justify-center shrink-0">
                        <Building size={18} className="text-primary-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">Unit {unit.unit_number}</p>
                        <p className="text-xs text-text-secondary">
                          {active} active resident{active !== 1 ? "s" : ""}
                          {total > active ? ` · ${total - active} inactive` : ""}
                        </p>
                      </div>
                      <Badge variant={active > 0 ? "success" : "neutral"}>
                        {active > 0 ? "Occupied" : "Vacant"}
                      </Badge>
                      <div className="hidden lg:flex items-center gap-0.5 ml-2">
                        <button title="Edit" onClick={(e) => { e.stopPropagation(); openEditUnit(unit); }} className="p-1.5 rounded-md hover:bg-primary-50 transition-colors text-text-secondary hover:text-primary-500 cursor-pointer"><Pencil size={15} /></button>
                        <button title="Delete" onClick={(e) => { e.stopPropagation(); setConfirmAction({ action: () => handleDeleteUnit(unit), title: "Delete Unit?", description: `Delete Unit ${unit.unit_number}? This cannot be undone.` }); }} className="p-1.5 rounded-md hover:bg-red-50 transition-colors text-text-secondary hover:text-red-500 cursor-pointer"><Trash2 size={15} /></button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
          <ShowMoreButton hasMore={unitsHasMore} isLoading={unitsLoadingMore} onLoadMore={loadMoreUnits} loadedCount={units.length} />
        </>
      )}

      {/* ─── Guests list ──────────────────────────────────────────── */}
      {viewMode === "guests" && (
        <>
          {guestsLoading ? (
            <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : filteredGuests.length === 0 ? (
            <EmptyState title="No guests" description="No guest stays found" />
          ) : (
            <div className="flex flex-col gap-2">
              {filteredGuests.map((guest) => (
                <Card key={guest.id}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                      <span className="text-blue-600 font-bold text-sm">{getInitials(guest.name)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{guest.name}</p>
                      <p className="text-xs text-text-secondary truncate">
                        Unit {guest.unit} · {guest.plate}
                        {guest.vehicle ? ` · ${guest.vehicle}` : ""}
                      </p>
                      <p className="text-[11px] text-text-secondary">
                        {format(guest.startDate, "MM/dd")} – {format(guest.endDate, "MM/dd")}
                      </p>
                    </div>
                    <Badge variant={
                      guest.status === "active" || guest.status === "approved" ? "success" :
                      guest.status === "needs_payment" ? "danger" :
                      guest.status === "pending" ? "warning" : "neutral"
                    }>
                      {guest.status.replace("_", " ")}
                    </Badge>
                  </div>
                </Card>
              ))}
            </div>
          )}
          <ShowMoreButton hasMore={guestsHasMore} isLoading={guestsLoadingMore} onLoadMore={fetchMoreGuests} loadedCount={guests.length} />
        </>
      )}

      {/* ─── Resident Detail Sheet ────────────────────────────────── */}
      <BottomSheet open={!!selectedResident} onClose={() => setSelectedResident(null)} title="Resident Details">
        {selectedResident && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col items-center gap-2 pb-2">
              <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center">
                <span className="text-primary-600 font-bold text-xl">{getInitials(selectedResident.full_name)}</span>
              </div>
              <p className="font-bold">{selectedResident.full_name}</p>
              <p className="text-xs text-text-secondary">Unit {selectedResident.unit_number}</p>
            </div>
            {[
              { label: "Email", value: selectedResident.email },
              { label: "Primary Contact", value: selectedResident.is_primary_contact ? "Yes" : "No" },
            ].map((row) => (
              <div key={row.label} className="flex justify-between text-sm">
                <span className="text-text-secondary">{row.label}</span>
                <span className="font-medium capitalize">{row.value}</span>
              </div>
            ))}
            <Button variant="secondary" className="w-full gap-1.5" onClick={() => openEditResident(selectedResident)}>
              <Pencil size={16} /> Edit Resident
            </Button>
            <div className="border-t border-border pt-3 mt-1">
              <p className="text-sm font-semibold mb-2">Guest Records</p>
              <TabBar tabs={historyTabs} active={historyTab} onChange={(k) => setHistoryTab(k as HistoryTab)} />
            </div>
            {staysLoading ? (
              <p className="text-xs text-text-secondary text-center py-4">Loading stays...</p>
            ) : activeStays.length === 0 ? (
              <p className="text-xs text-text-secondary text-center py-4">
                {historyTab === "current" && "No active guests"}
                {historyTab === "upcoming" && "No upcoming guests"}
                {historyTab === "previous" && "No previous records"}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {activeStays.map((stay) => {
                  const now = startOfDay(new Date());
                  const start = new Date(stay.start_date);
                  const end = new Date(stay.end_date);
                  let extra = "";
                  if (historyTab === "current") {
                    const remaining = differenceInDays(end, now);
                    extra = `${remaining} day${remaining !== 1 ? "s" : ""} remaining`;
                  } else if (historyTab === "upcoming") {
                    const daysUntil = differenceInDays(start, now);
                    extra = `Starts in ${daysUntil} day${daysUntil !== 1 ? "s" : ""}`;
                  }
                  return (
                    <div key={stay.id} className={`flex items-center gap-3 p-2.5 rounded-[10px] bg-surface-dim ${historyTab === "previous" ? "opacity-60" : ""}`}>
                      <Car size={16} className="text-text-secondary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{stay.guest_name}</p>
                        <p className="text-xs text-text-secondary truncate">{stay.vehicle_desc || stay.vehicle_plate}</p>
                        {extra && <p className="text-[11px] text-primary-500">{extra}</p>}
                        {historyTab === "previous" && (
                          <p className="text-[11px] text-text-secondary">{format(start, "MM/dd")} – {format(end, "MM/dd")}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </BottomSheet>

      {/* ─── Add Resident Sheet ───────────────────────────────────── */}
      <BottomSheet open={showAddResident} onClose={() => { setShowAddResident(false); setAddResidentError(null); }} title="Add Resident">
        <form onSubmit={handleAddResident} className="flex flex-col gap-3">
          {addResidentError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{addResidentError}</div>}
          <Input label="Full Name" icon={User} placeholder="Jane Doe" value={addResidentForm.fullName} onChange={(e) => setAddResidentForm((f) => ({ ...f, fullName: e.target.value }))} required />
          <Input label="Email" icon={Mail} type="email" placeholder="resident@email.com" value={addResidentForm.email} onChange={(e) => setAddResidentForm((f) => ({ ...f, email: e.target.value }))} required />
          <Input label="Unit Number" icon={Building} placeholder="4052" value={addResidentForm.unitNumber} onChange={(e) => setAddResidentForm((f) => ({ ...f, unitNumber: e.target.value }))} required />
          <Input label="Password" icon={Lock} type="password" placeholder="Temporary password" value={addResidentForm.password} onChange={(e) => setAddResidentForm((f) => ({ ...f, password: e.target.value }))} required />
          <Button type="submit" loading={addResidentSubmitting} className="w-full mt-2">Create Resident</Button>
        </form>
      </BottomSheet>

      {/* ─── Edit Resident Sheet ──────────────────────────────────── */}
      <BottomSheet open={!!editingResident} onClose={() => { setEditingResident(null); setEditResidentError(null); }} title="Edit Resident">
        {editingResident && (
          <form onSubmit={handleEditResident} className="flex flex-col gap-3">
            {editResidentError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{editResidentError}</div>}
            <Input label="Full Name" icon={User} value={editResidentForm.fullName} onChange={(e) => setEditResidentForm((f) => ({ ...f, fullName: e.target.value }))} required />
            <Input label="Email" icon={Mail} type="email" value={editResidentForm.email} onChange={(e) => setEditResidentForm((f) => ({ ...f, email: e.target.value }))} required />
            <Input label="Unit Number" icon={Building} value={editResidentForm.unitNumber} onChange={(e) => setEditResidentForm((f) => ({ ...f, unitNumber: e.target.value }))} required />
            <Button type="submit" loading={editResidentSubmitting} className="w-full mt-2">Save Changes</Button>
          </form>
        )}
      </BottomSheet>

      {/* ─── Add Unit Sheet ───────────────────────────────────────── */}
      <BottomSheet open={showAddUnit} onClose={() => setShowAddUnit(false)} title="Add Unit">
        <form onSubmit={handleAddUnit} className="flex flex-col gap-3">
          {addUnitError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{addUnitError}</div>}
          <Input label="Unit Number" icon={Building} placeholder="A-101" value={addUnitForm.unitNumber} onChange={(e) => setAddUnitForm((f) => ({ ...f, unitNumber: e.target.value }))} required />
          <Input label="Building Code" icon={Building} placeholder="A (optional)" value={addUnitForm.buildingCode} onChange={(e) => setAddUnitForm((f) => ({ ...f, buildingCode: e.target.value }))} />
          <Button type="submit" loading={addUnitSubmitting} className="w-full mt-2">Create Unit</Button>
        </form>
      </BottomSheet>

      {/* ─── Unit Detail Sheet ─────────────────────────────────────── */}
      <BottomSheet open={!!selectedUnit} onClose={() => setSelectedUnit(null)} title={`Unit ${selectedUnit?.unit_number || ""}`}>
        {selectedUnit && (() => {
          const unitResidents = residents.filter((r) => r.unit_number === selectedUnit.unit_number);
          return (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 pb-2">
                <div className="w-12 h-12 rounded-full bg-primary-50 flex items-center justify-center">
                  <Building size={22} className="text-primary-500" />
                </div>
                <div>
                  <p className="font-bold">Unit {selectedUnit.unit_number}</p>
                  {selectedUnit.building_code && <p className="text-xs text-text-secondary">Building {selectedUnit.building_code}</p>}
                </div>
                <span className="ml-auto">
                  <Badge variant={Number(selectedUnit.active_residents) > 0 ? "success" : "neutral"}>
                    {Number(selectedUnit.active_residents) > 0 ? "Occupied" : "Vacant"}
                  </Badge>
                </span>
              </div>

              <div className="border-t border-border pt-3">
                <p className="text-sm font-semibold mb-2">Residents ({unitResidents.length})</p>
                {unitResidents.length === 0 ? (
                  <p className="text-xs text-text-secondary text-center py-4">No residents in this unit</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {unitResidents.map((r) => (
                      <div key={r.id} className="flex items-center gap-3 p-2.5 rounded-[10px] bg-surface-dim">
                        <div className="w-8 h-8 rounded-full bg-primary-50 flex items-center justify-center shrink-0">
                          <span className="text-primary-600 font-bold text-xs">{getInitials(r.full_name)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{r.full_name}</p>
                          <p className="text-xs text-text-secondary truncate">{r.email}</p>
                        </div>
                        {r.is_primary_contact && (
                          <Badge variant="info">Primary</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="secondary" className="flex-1 gap-1.5" onClick={() => { openEditUnit(selectedUnit); setSelectedUnit(null); }}>
                  <Pencil size={16} /> Edit Unit
                </Button>
                <Button variant="ghost" className="flex-shrink-0 text-danger gap-1.5" onClick={() => { setConfirmAction({ action: () => handleDeleteUnit(selectedUnit), title: "Delete Unit?", description: `Delete Unit ${selectedUnit.unit_number}? This cannot be undone.` }); setSelectedUnit(null); }}>
                  <Trash2 size={16} /> Delete
                </Button>
              </div>
            </div>
          );
        })()}
      </BottomSheet>

      {/* ─── Edit Unit Sheet ──────────────────────────────────────── */}
      <BottomSheet open={!!editingUnit} onClose={() => setEditingUnit(null)} title="Edit Unit">
        {editingUnit && (
          <form onSubmit={handleEditUnit} className="flex flex-col gap-3">
            {editUnitError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{editUnitError}</div>}
            <Input label="Unit Number" icon={Building} value={editUnitForm.unitNumber} onChange={(e) => setEditUnitForm((f) => ({ ...f, unitNumber: e.target.value }))} required />
            <Input label="Building Code" icon={Building} placeholder="Optional" value={editUnitForm.buildingCode} onChange={(e) => setEditUnitForm((f) => ({ ...f, buildingCode: e.target.value }))} />
            <Button type="submit" loading={editUnitSubmitting} className="w-full mt-2">Save Changes</Button>
          </form>
        )}
      </BottomSheet>

      <ConfirmDialog
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={async () => { await confirmAction?.action(); setConfirmAction(null); }}
        title={confirmAction?.title || ""}
        description={confirmAction?.description || ""}
        variant="danger"
      />
    </div>
  );
}
