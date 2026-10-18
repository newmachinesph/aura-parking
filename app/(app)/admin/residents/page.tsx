"use client";

import { useState, useEffect, useCallback } from "react";
import SearchBar from "@/components/ui/SearchBar";
import StatsCard from "@/components/ui/StatsCard";
import Card from "@/components/ui/Card";
import BottomSheet from "@/components/ui/BottomSheet";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import TabBar from "@/components/ui/TabBar";
import ShowMoreButton from "@/components/ui/ShowMoreButton";
import Skeleton from "@/components/ui/Skeleton";
import { apiFetch, ApiError } from "@/lib/api";
import { getInitials } from "@/lib/helpers";
import { Car, Pencil, User, Mail, Building, Plus, Users, Clock, CheckCircle, Lock, XCircle, Trash2 } from "lucide-react";
import { isBefore, isAfter, isToday, startOfDay, differenceInDays, format } from "date-fns";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

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

type ResidentTab = "all" | "active" | "inactive";

export default function AdminResidents() {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<ResidentTab>("all");
  const [selected, setSelected] = useState<Resident | null>(null);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Guest history state
  const [historyTab, setHistoryTab] = useState<HistoryTab>("current");
  const [guestStays, setGuestStays] = useState<GuestStay[]>([]);
  const [staysLoading, setStaysLoading] = useState(false);

  // Edit state
  const [editingResident, setEditingResident] = useState<Resident | null>(null);
  const [editForm, setEditForm] = useState({ fullName: "", email: "", unitNumber: "", status: "ACTIVE" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { toast } = useToast();

  // Add resident state
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ fullName: "", email: "", password: "", unitNumber: "" });
  const [addError, setAddError] = useState<string | null>(null);
  const [addSubmitting, setAddSubmitting] = useState(false);

  const loadResidents = useCallback(() => {
    apiFetch<{ residents: Resident[]; hasMore: boolean; nextCursor: number | null }>("/api/residents")
      .then((data) => {
        setResidents(data.residents);
        setHasMore(data.hasMore ?? false);
        setNextCursor(data.nextCursor ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadResidents(); }, [loadResidents]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const data = await apiFetch<{ residents: Resident[]; hasMore: boolean; nextCursor: number | null }>(
        `/api/residents?cursor=${nextCursor}&limit=50`
      );
      setResidents((prev) => [...prev, ...data.residents]);
      setHasMore(data.hasMore ?? false);
      setNextCursor(data.nextCursor ?? null);
    } catch {
      // silent
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, nextCursor]);

  const loadGuestStays = useCallback(async (residentId: number) => {
    setStaysLoading(true);
    try {
      const data = await apiFetch<{ stays: GuestStay[] }>(
        `/api/residents/${residentId}/guest-stays`
      );
      setGuestStays(data.stays || []);
    } catch {
      setGuestStays([]);
    } finally {
      setStaysLoading(false);
    }
  }, []);

  const handleSelectResident = (r: Resident) => {
    setSelected(r);
    setHistoryTab("current");
    setGuestStays([]);
    loadGuestStays(r.id);
  };

  const openEdit = (r: Resident) => {
    setEditingResident(r);
    setEditForm({ fullName: r.full_name, email: r.email, unitNumber: r.unit_number, status: (r.status || "ACTIVE").toUpperCase() });
    setFormError(null);
    setSelected(null);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingResident) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await apiFetch(`/api/residents/${editingResident.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          fullName: editForm.fullName,
          email: editForm.email,
          unitNumber: editForm.unitNumber,
          status: editForm.status,
        }),
      });
      setResidents((prev) =>
        prev.map((r) =>
          r.id === editingResident.id
            ? { ...r, full_name: editForm.fullName, email: editForm.email, unit_number: editForm.unitNumber, status: editForm.status }
            : r
        )
      );
      setEditingResident(null);
      toast({ title: "Resident updated", variant: "success" });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to update resident");
      toast({ title: "Update failed", description: err instanceof ApiError ? err.message : "Failed to update", variant: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddResident = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddSubmitting(true);
    setAddError(null);
    try {
      await apiFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: addForm.email,
          password: addForm.password,
          role: "resident",
          fullName: addForm.fullName,
          unitNumber: addForm.unitNumber,
        }),
      });
      setShowAdd(false);
      setAddForm({ fullName: "", email: "", password: "", unitNumber: "" });
      loadResidents();
      toast({ title: "Resident created", variant: "success" });
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "Failed to create resident");
      toast({ title: "Failed to create resident", description: err instanceof ApiError ? err.message : "Failed", variant: "error" });
    } finally {
      setAddSubmitting(false);
    }
  };

  const [confirmAction, setConfirmAction] = useState<{ action: () => Promise<void>; title: string; description: string } | null>(null);

  const handleToggleStatus = async (r: Resident) => {
    const newStatus = (r.status || "").toUpperCase() === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      await apiFetch(`/api/residents/${r.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      setResidents((prev) => prev.map((res) => res.id === r.id ? { ...res, status: newStatus } : res));
      toast({ title: `Resident ${newStatus === "ACTIVE" ? "activated" : "deactivated"}`, variant: "success" });
    } catch (err) {
      toast({ title: "Failed to update status", description: err instanceof ApiError ? err.message : "Failed", variant: "error" });
    }
  };

  const handleDelete = async (r: Resident) => {
    try {
      await apiFetch(`/api/residents/${r.id}`, { method: "DELETE" });
      setResidents((prev) => prev.filter((res) => res.id !== r.id));
      setSelected(null);
      toast({ title: "Resident deleted", variant: "success" });
    } catch (err) {
      toast({ title: "Failed to delete", description: err instanceof ApiError ? err.message : "Failed", variant: "error" });
    }
  };

  // Stats
  const activeCount = residents.filter((r) => (r.status || "").toLowerCase() === "active").length;
  const inactiveCount = residents.filter((r) => (r.status || "").toLowerCase() !== "active").length;

  const tabs = [
    { key: "all", label: "All", icon: Users, count: residents.length },
    { key: "active", label: "Active", icon: CheckCircle, count: activeCount },
    { key: "inactive", label: "Inactive", icon: Clock, count: inactiveCount },
  ];

  const q = search.toLowerCase();
  const tabFiltered = residents.filter((r) => {
    if (tab === "active") return (r.status || "").toLowerCase() === "active";
    if (tab === "inactive") return (r.status || "").toLowerCase() !== "active";
    return true;
  });
  const filtered = tabFiltered.filter(
    (r) =>
      !q ||
      r.full_name.toLowerCase().includes(q) ||
      r.unit_number.toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q)
  );

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

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Residents</h1>
          <p className="text-sm text-text-secondary mt-0.5">View all registered residents and their guest parking history.</p>
        </div>
        <Button onClick={() => { setShowAdd(true); setAddError(null); }} className="gap-1.5 px-3 min-h-10 text-sm shrink-0">
          <Plus size={16} /> Add Resident
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <StatsCard title="Total Residents" value={residents.length} accent="primary" icon={Users} />
      </div>

      <SearchBar value={search} onChange={setSearch} placeholder="Search by name, unit, or email..." />

      <TabBar tabs={tabs} active={tab} onChange={(k) => setTab(k as ResidentTab)} />

      {loading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState title="No residents" description="No residents match your search" />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((r) => (
            <Card key={r.id} onClick={() => handleSelectResident(r)}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary-50 flex items-center justify-center shrink-0">
                  <span className="text-primary-600 font-bold text-sm">{getInitials(r.full_name)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm truncate">{r.full_name}</p>
                    {(r.status || "").toUpperCase() !== "ACTIVE" && (
                      <Badge variant="neutral" className="text-[10px] px-1.5 py-0">{(r.status || "INACTIVE").toUpperCase()}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-text-secondary">{r.unit_number} · {r.email}</p>
                </div>
                <div className="hidden lg:flex items-center gap-0.5 ml-2">
                  <button
                    title="Edit"
                    onClick={(e) => { e.stopPropagation(); openEdit(r); }}
                    className="p-1.5 rounded-md hover:bg-primary-50 transition-colors text-text-secondary hover:text-primary-500 cursor-pointer"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    title="Delete"
                    onClick={(e) => { e.stopPropagation(); setConfirmAction({ action: () => handleDelete(r), title: "Delete Resident?", description: `Permanently delete ${r.full_name}?` }); }}
                    className="p-1.5 rounded-md hover:bg-red-50 transition-colors text-text-secondary hover:text-red-500 cursor-pointer"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ShowMoreButton hasMore={hasMore} isLoading={loadingMore} onLoadMore={loadMore} loadedCount={residents.length} />

      {/* Detail sheet */}
      <BottomSheet open={!!selected} onClose={() => setSelected(null)} title="Resident Details">
        {selected && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col items-center gap-2 pb-2">
              <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center">
                <span className="text-primary-600 font-bold text-xl">{getInitials(selected.full_name)}</span>
              </div>
              <p className="font-bold">{selected.full_name}</p>
              <p className="text-xs text-text-secondary">Unit {selected.unit_number}</p>
            </div>

            {[
              { label: "Email", value: selected.email },
              { label: "Status", value: (selected.status || "ACTIVE").toUpperCase() },
              { label: "Primary Contact", value: selected.is_primary_contact ? "Yes" : "No" },
            ].map((row) => (
              <div key={row.label} className="flex justify-between text-sm">
                <span className="text-text-secondary">{row.label}</span>
                <span className={`font-medium capitalize ${row.label === "Status" && row.value !== "ACTIVE" ? "text-amber-600" : ""}`}>{row.value}</span>
              </div>
            ))}

            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1 gap-1.5" onClick={() => openEdit(selected)}>
                <Pencil size={16} /> Edit
              </Button>
              <Button
                variant={(selected.status || "").toUpperCase() === "ACTIVE" ? "danger" : "primary"}
                className="flex-1 gap-1.5"
                onClick={() => {
                  setConfirmAction({
                    action: async () => { await handleToggleStatus(selected); setSelected(null); },
                    title: (selected.status || "").toUpperCase() === "ACTIVE" ? "Deactivate Resident?" : "Activate Resident?",
                    description: (selected.status || "").toUpperCase() === "ACTIVE"
                      ? `Deactivate ${selected.full_name}? They will no longer be able to approve guests.`
                      : `Activate ${selected.full_name}? They will be able to approve guests again.`,
                  });
                }}
              >
                {(selected.status || "").toUpperCase() === "ACTIVE" ? (
                  <><XCircle size={16} /> Deactivate</>
                ) : (
                  <><CheckCircle size={16} /> Activate</>
                )}
              </Button>
            </div>

            {/* Guest History */}
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
                    <div
                      key={stay.id}
                      className={`flex items-center gap-3 p-2.5 rounded-[10px] bg-surface-dim ${historyTab === "previous" ? "opacity-60" : ""}`}
                    >
                      <Car size={16} className="text-text-secondary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{stay.guest_name}</p>
                        <p className="text-xs text-text-secondary truncate">
                          {stay.vehicle_desc || stay.vehicle_plate}
                        </p>
                        {extra && (
                          <p className="text-[11px] text-primary-500">{extra}</p>
                        )}
                        {historyTab === "previous" && (
                          <p className="text-[11px] text-text-secondary">
                            {format(start, "MM/dd")} – {format(end, "MM/dd")}
                          </p>
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

      {/* Add Resident sheet */}
      <BottomSheet open={showAdd} onClose={() => { setShowAdd(false); setAddError(null); }} title="Add Resident">
        <form onSubmit={handleAddResident} className="flex flex-col gap-3">
          {addError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{addError}</div>
          )}
          <Input label="Full Name" icon={User} placeholder="Jane Doe" value={addForm.fullName} onChange={(e) => setAddForm((f) => ({ ...f, fullName: e.target.value }))} required />
          <Input label="Email" icon={Mail} type="email" placeholder="resident@email.com" value={addForm.email} onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))} required />
          <Input label="Unit Number" icon={Building} placeholder="4052" value={addForm.unitNumber} onChange={(e) => setAddForm((f) => ({ ...f, unitNumber: e.target.value }))} required />
          <Input label="Password" icon={Lock} type="password" placeholder="Temporary password" value={addForm.password} onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))} required />
          <Button type="submit" loading={addSubmitting} className="w-full mt-2">Create Resident</Button>
        </form>
      </BottomSheet>

      {/* Edit Resident sheet */}
      <BottomSheet open={!!editingResident} onClose={() => { setEditingResident(null); setFormError(null); }} title="Edit Resident">
        {editingResident && (
          <form onSubmit={handleEdit} className="flex flex-col gap-3">
            {formError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{formError}</div>
            )}
            <Input label="Full Name" icon={User} value={editForm.fullName} onChange={(e) => setEditForm((f) => ({ ...f, fullName: e.target.value }))} required />
            <Input label="Email" icon={Mail} type="email" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} required />
            <Input label="Unit Number" icon={Building} value={editForm.unitNumber} onChange={(e) => setEditForm((f) => ({ ...f, unitNumber: e.target.value }))} required />
            <Button type="submit" loading={submitting} className="w-full mt-2">Save Changes</Button>
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
