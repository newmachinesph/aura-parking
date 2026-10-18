"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useGuestStore, type Guest } from "@/stores/guestStore";
import SearchBar from "@/components/ui/SearchBar";
import StatsCard from "@/components/ui/StatsCard";
import GuestCard from "@/components/shared/GuestCard";
import BottomSheet from "@/components/ui/BottomSheet";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import DateRangePicker from "@/components/ui/DateRangePicker";
import EmptyState from "@/components/ui/EmptyState";
import TabBar from "@/components/ui/TabBar";
import Badge from "@/components/ui/Badge";
import ShowMoreButton from "@/components/ui/ShowMoreButton";
import { GuestCardSkeleton } from "@/components/ui/Skeleton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { apiFetch, ApiError } from "@/lib/api";
import { User, Car, Mail, Copy, Check, Trash2, ShieldOff, Plus, Building, AlertTriangle, Timer, Clock, CalendarClock, Hourglass, CalendarPlus, Pencil, CheckCircle } from "lucide-react";
import { format, differenceInDays, isBefore, isAfter, isToday, startOfDay } from "date-fns";
import { RATE_PER_DAY } from "@/lib/constants";
import { useToast } from "@/components/ui/Toast";

type FilterKey = "pending" | "active" | "upcoming" | "expired";

function isPastGuest(guest: Guest) {
  const now = startOfDay(new Date());
  return (
    guest.status === "cancelled" ||
    guest.status === "expired" ||
    (guest.status === "paid" && isBefore(guest.endDate, now) && !isToday(guest.endDate))
  );
}

export default function AdminGuests() {
  const {
    guests, search, setSearch, updateGuest, deleteGuest, approveGuest,
    fetchGuests, isLoading, error, hasMore, isLoadingMore, fetchMoreGuests,
  } = useGuestStore();
  const [tab, setTab] = useState<FilterKey>("active");
  const [selected, setSelected] = useState<Guest | null>(null);
  const [editingGuest, setEditingGuest] = useState<Guest | null>(null);
  const [copied, setCopied] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", plate: "", vehicle: "", email: "", startDate: "", endDate: "" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [bypassLoading, setBypassLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ action: () => Promise<void>; title: string; description: string } | null>(null);

  const { toast } = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Add guest state
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ unitNumber: "", name: "", email: "", plate: "", vehicle: "", startDate: "", endDate: "" });
  const [addError, setAddError] = useState<string | null>(null);
  const [addSubmitting, setAddSubmitting] = useState(false);

  // Bypass payment override state
  const [showBypassSheet, setShowBypassSheet] = useState(false);
  const [bypassGuest, setBypassGuest] = useState<Guest | null>(null);
  const [overrideBillableDays, setOverrideBillableDays] = useState(0);
  const [bypassError, setBypassError] = useState<string | null>(null);

  useEffect(() => { fetchGuests(undefined, "createdByAdmin=true"); }, [fetchGuests]);

  // Read tab from URL (?tab=pending)
  useEffect(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab && ["pending", "active", "upcoming", "expired"].includes(urlTab)) {
      setTab(urlTab as FilterKey);
      router.replace("/admin/guests", { scroll: false });
    }
  }, [searchParams, router]);

  const updateEdit = (key: string, val: string) => setEditForm((f) => ({ ...f, [key]: val }));
  const updateAdd = (key: string, val: string) => setAddForm((f) => ({ ...f, [key]: val }));

  // Stats
  const now = startOfDay(new Date());
  const activeCount = guests.filter((g) => {
    if (g.status !== "active" && g.status !== "approved") return false;
    // Exclude future (upcoming) stays from active count
    return !isAfter(g.startDate, now);
  }).length;
  const upcomingCount = guests.filter((g) => {
    return g.status === "approved" && isAfter(g.startDate, now);
  }).length;
  const pendingCount = guests.filter((g) => g.status === "pending").length;
  const pastCount = guests.filter(isPastGuest).length;

  // Tab filtering helpers
  function isActive(g: Guest) {
    const s = g.status;
    if (s === "pending" || s === "cancelled" || s === "expired") return false;
    // approved, active, needs_payment, paid — currently within date range
    return !isAfter(g.startDate, now) && (isAfter(g.endDate, now) || isToday(g.endDate));
  }
  function isUpcoming(g: Guest) {
    const s = g.status;
    if (s === "cancelled" || s === "expired") return false;
    return (s === "approved" || s === "needs_payment" || s === "pending") && isAfter(g.startDate, now);
  }
  function isExpired(g: Guest) {
    return isPastGuest(g) || (
      !["pending", "cancelled"].includes(g.status) &&
      isBefore(g.endDate, now) && !isToday(g.endDate)
    );
  }

  const expiredCount = guests.filter(isExpired).length;

  const q = search.toLowerCase();
  const filtered = guests
    .filter((g) => {
      if (tab === "pending") return g.status === "pending";
      if (tab === "active") return isActive(g);
      if (tab === "upcoming") return isUpcoming(g);
      if (tab === "expired") return isExpired(g);
      return true;
    })
    .filter(
      (g) =>
        !q ||
        g.name.toLowerCase().includes(q) ||
        g.plate.toLowerCase().includes(q) ||
        g.unit.toLowerCase().includes(q) ||
        g.vehicle.toLowerCase().includes(q)
    );

  const tabs = [
    { key: "pending", label: "Pending", icon: Clock, count: pendingCount },
    { key: "active", label: "Active", icon: Timer, count: activeCount },
    { key: "upcoming", label: "Upcoming", icon: CalendarClock, count: upcomingCount },
    { key: "expired", label: "Expired", icon: Hourglass, count: expiredCount },
  ];

  function getBillableInfo(guest: Guest) {
    const totalNights = Math.max(1, differenceInDays(guest.endDate, guest.startDate));
    if (guest.billableNights > 0 || guest.amountDue > 0 || guest.status !== "pending") {
      return {
        totalNights,
        freeDays: guest.freePassUsed,
        billableDays: guest.billableNights,
        amount: guest.amountDue,
      };
    }
    return { totalNights, freeDays: 0, billableDays: totalNights, amount: totalNights * RATE_PER_DAY };
  }

  const handleApprove = async (guest: Guest) => {
    try {
      await approveGuest(guest.id);
      setSelected(null);
      toast({ title: "Guest approved", variant: "success" });
    } catch {
      // handled by store
    }
  };

  const handleReject = async (guest: Guest) => {
    try {
      await deleteGuest(guest.id);
      setSelected(null);
      toast({ title: "Guest rejected", variant: "success" });
    } catch {
      // handled by store
    }
  };

  const handleDelete = async (guest: Guest) => {
    try {
      await deleteGuest(guest.id);
      setSelected(null);
      toast({ title: "Guest deleted", variant: "success" });
    } catch {
      // handled by store
    }
  };

  // Open bypass sheet with override controls
  const openBypassSheet = (guest: Guest) => {
    const billing = getBillableInfo(guest);
    setBypassGuest(guest);
    setOverrideBillableDays(billing.billableDays);
    setBypassError(null);
    setShowBypassSheet(true);
    setSelected(null);
  };

  const handleBypassPayment = async () => {
    if (!bypassGuest) return;
    setBypassLoading(true);
    setBypassError(null);
    try {
      await apiFetch(`/api/guest-stays/${bypassGuest.id}/admin-bypass-payment`, {
        method: "POST",
        body: JSON.stringify({ billableDays: overrideBillableDays, adminNote: "Admin bypass" }),
      });
      await fetchGuests();
      setShowBypassSheet(false);
      setBypassGuest(null);
      toast({ title: "Payment bypassed", variant: "success" });
    } catch (err) {
      setBypassError(err instanceof ApiError ? err.message : "Failed to bypass payment");
      toast({ title: "Bypass failed", description: err instanceof ApiError ? err.message : "Failed to bypass payment", variant: "error" });
    } finally {
      setBypassLoading(false);
    }
  };

  const openEdit = (guest: Guest) => {
    setEditingGuest(guest);
    setEditForm({
      name: guest.name,
      plate: guest.plate,
      vehicle: guest.vehicle,
      email: guest.email,
      startDate: format(guest.startDate, "yyyy-MM-dd"),
      endDate: format(guest.endDate, "yyyy-MM-dd"),
    });
    setSelected(null);
    setFormError(null);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGuest) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await updateGuest(editingGuest.id, {
        name: editForm.name,
        plate: editForm.plate,
        vehicle: editForm.vehicle,
        startDate: editForm.startDate,
        endDate: editForm.endDate,
      });
      setEditingGuest(null);
      toast({ title: "Guest updated", variant: "success" });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to update guest");
      toast({ title: "Update failed", description: err instanceof Error ? err.message : "Failed to update guest", variant: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const openAddStayForGuest = (guest: Guest) => {
    setAddForm({
      unitNumber: guest.unit,
      name: guest.name,
      email: guest.email,
      plate: guest.plate,
      vehicle: guest.vehicle,
      startDate: "",
      endDate: "",
    });
    setAddError(null);
    setSelected(null);
    setShowAdd(true);
  };

  const handleAddGuest = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddSubmitting(true);
    setAddError(null);
    try {
      await apiFetch("/api/guest-stays", {
        method: "POST",
        body: JSON.stringify({
          unitNumber: addForm.unitNumber,
          guest: { fullName: addForm.name, email: addForm.email || undefined },
          vehicle: { plate: addForm.plate, desc: addForm.vehicle || undefined },
          stay: { startDate: addForm.startDate, endDate: addForm.endDate },
          autoApprove: true,
        }),
      });
      await fetchGuests(undefined, "createdByAdmin=true");
      setAddForm({ unitNumber: "", name: "", email: "", plate: "", vehicle: "", startDate: "", endDate: "" });
      setShowAdd(false);
      toast({ title: "Guest added", variant: "success" });
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "Failed to add guest");
      toast({ title: "Failed to add guest", description: err instanceof ApiError ? err.message : "Failed to add guest", variant: "error" });
    } finally {
      setAddSubmitting(false);
    }
  };

  const copyPaymentLink = async (guest: Guest) => {
    const url = `${window.location.origin}/payment?stayId=${guest.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
    }
    setTimeout(() => setCopied(false), 2000);
  };

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });

  // Calculate add form nights
  const addFormNights = addForm.startDate && addForm.endDate
    ? Math.max(0, differenceInDays(new Date(addForm.endDate), new Date(addForm.startDate)))
    : 0;

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Add Guest</h1>
          <p className="text-sm text-text-secondary mt-0.5">Guests manually added by admins.</p>
        </div>
        <Button onClick={() => { setShowAdd(true); setAddError(null); }} className="gap-1.5 px-3 min-h-10 text-sm shrink-0">
          <Plus size={16} /> Add Guest
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatsCard title="Active" value={activeCount} accent="success" icon={Timer} />
        <StatsCard title="Upcoming" value={upcomingCount} accent="info" icon={CalendarClock} />
        <StatsCard title="Pending" value={pendingCount} accent="warning" icon={Clock} />
        <StatsCard title="Past" value={pastCount} accent="danger" icon={Hourglass} />
      </div>

      <SearchBar value={search} onChange={setSearch} placeholder="Search by name, plate, vehicle, or unit" />

      <TabBar tabs={tabs} active={tab} onChange={(k) => setTab(k as FilterKey)} />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{error}</div>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <GuestCardSkeleton key={i} />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState title="No guests" description="No guests match your filter" />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((guest) => (
            <GuestCard
              key={guest.id}
              guest={guest}
              onTap={setSelected}
              desktopActions={
                <>
                  {guest.status === "pending" && (
                    <button
                      title="Approve"
                      onClick={(e) => { e.stopPropagation(); handleApprove(guest); }}
                      className="p-1.5 rounded-md hover:bg-green-50 transition-colors text-text-secondary hover:text-green-600 cursor-pointer"
                    >
                      <CheckCircle size={15} />
                    </button>
                  )}
                  {guest.status === "needs_payment" && (
                    <button
                      title="Bypass Payment"
                      onClick={(e) => { e.stopPropagation(); openBypassSheet(guest); }}
                      className="p-1.5 rounded-md hover:bg-amber-50 transition-colors text-text-secondary hover:text-amber-600 cursor-pointer"
                    >
                      <ShieldOff size={15} />
                    </button>
                  )}
                  {!["cancelled", "expired", "pending"].includes(guest.status) && (
                    <button
                      title="Book Another Stay"
                      onClick={(e) => { e.stopPropagation(); openAddStayForGuest(guest); }}
                      className="p-1.5 rounded-md hover:bg-primary-50 transition-colors text-text-secondary hover:text-primary-500 cursor-pointer"
                    >
                      <CalendarPlus size={15} />
                    </button>
                  )}
                  {!["pending", "cancelled", "expired"].includes(guest.status) && (
                    <button
                      title="Edit"
                      onClick={(e) => { e.stopPropagation(); openEdit(guest); }}
                      className="p-1.5 rounded-md hover:bg-primary-50 transition-colors text-text-secondary hover:text-primary-500 cursor-pointer"
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                  <button
                    title="Delete"
                    onClick={(e) => { e.stopPropagation(); setConfirmAction({ action: () => handleDelete(guest), title: "Delete Guest?", description: `Permanently delete ${guest.name}'s stay record?` }); }}
                    className="p-1.5 rounded-md hover:bg-red-50 transition-colors text-text-secondary hover:text-red-500 cursor-pointer"
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              }
            />
          ))}
        </div>
      )}

      <ShowMoreButton hasMore={hasMore} isLoading={isLoadingMore} onLoadMore={fetchMoreGuests} loadedCount={guests.length} />

      {/* Add Guest Sheet */}
      <BottomSheet open={showAdd} onClose={() => setShowAdd(false)} title="Add Guest">
        <form onSubmit={handleAddGuest} className="flex flex-col gap-3">
          {addError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{addError}</div>
          )}
          <Input label="Unit *" icon={Building} placeholder="Enter unit number (e.g. 4052)" value={addForm.unitNumber} onChange={(e) => updateAdd("unitNumber", e.target.value)} required />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Name *" icon={User} placeholder="First Last" value={addForm.name} onChange={(e) => updateAdd("name", e.target.value)} required />
            <Input label="Email" icon={Mail} type="email" placeholder="guest@email.com" value={addForm.email} onChange={(e) => updateAdd("email", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Plate *" icon={Car} placeholder="ABC-1234" value={addForm.plate} onChange={(e) => updateAdd("plate", e.target.value)} required />
            <Input label="Vehicle *" icon={Car} placeholder="Toyota Corolla 2020" value={addForm.vehicle} onChange={(e) => updateAdd("vehicle", e.target.value)} required />
          </div>
          <DateRangePicker
            label="Stay Duration"
            startDate={addForm.startDate}
            endDate={addForm.endDate}
            onChange={(start, end) => {
              setAddForm((f) => ({ ...f, startDate: start, endDate: end }));
            }}
            min={today}
            required
          />
          {addFormNights > 0 && (
            <p className="text-xs text-text-secondary">
              {addFormNights} day{addFormNights !== 1 ? "s" : ""} &middot; ${(addFormNights * RATE_PER_DAY).toFixed(0)} max
            </p>
          )}
          <Button type="submit" loading={addSubmitting} className="w-full mt-2">Save Guest</Button>
          <Button type="button" variant="secondary" className="w-full" onClick={() => setShowAdd(false)}>Cancel</Button>
        </form>
      </BottomSheet>

      {/* Guest Detail Sheet */}
      <BottomSheet open={!!selected} onClose={() => { setSelected(null); setFormError(null); }} title="Approve Guest">
        {selected && (() => {
          const billing = getBillableInfo(selected);
          return (
            <div className="flex flex-col gap-4">
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{formError}</div>
              )}
              <div className="flex flex-col gap-2">
                {[
                  { label: "Unit", value: selected.unit ? `Unit ${selected.unit}` : "—" },
                  { label: "Name", value: selected.name },
                  { label: "Plate", value: selected.plate },
                  { label: "Vehicle", value: selected.vehicle },
                  { label: "Email", value: selected.email },
                ].map((row) => (
                  <div key={row.label} className="flex justify-between text-sm">
                    <span className="text-text-secondary">{row.label}</span>
                    <span className="font-medium">{row.value || "—"}</span>
                  </div>
                ))}
              </div>

              {/* Stay Duration */}
              <div className="bg-surface-dim rounded-[10px] p-3">
                <p className="text-xs font-medium text-text-secondary mb-1">Stay Duration</p>
                <p className="text-sm font-semibold">
                  {format(selected.startDate, "MM/dd")} – {format(selected.endDate, "MM/dd")}
                </p>
                <p className="text-xs text-text-secondary">{billing.totalNights} day(s) total</p>
              </div>

              {/* Status */}
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

              {/* Billing */}
              <div className="bg-surface-dim rounded-[10px] p-3 flex flex-col gap-1.5">
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Billing</p>
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Total nights</span>
                  <span className="font-medium">{billing.totalNights}</span>
                </div>
                {billing.freeDays > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Free pass</span>
                    <span className="font-medium text-success">-{billing.freeDays} night{billing.freeDays !== 1 ? "s" : ""}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Billable</span>
                  <span className="font-medium">{billing.billableDays} × ${RATE_PER_DAY}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-border pt-1.5">
                  <span className="font-semibold">Total</span>
                  <span className="font-bold">${billing.amount.toFixed(2)}</span>
                </div>
              </div>

              {/* Pending approval */}
              {selected.status === "pending" && (
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => handleApprove(selected)}>
                    Approve
                  </Button>
                  <Button variant="danger" className="flex-shrink-0 px-4" onClick={() => setConfirmAction({ action: () => handleReject(selected), title: "Reject Guest?", description: `This will reject and remove ${selected.name}'s stay request.` })}>
                    <Trash2 size={16} />
                  </Button>
                </div>
              )}

              {/* Bypass Payment — opens override sheet */}
              {selected.status === "needs_payment" && (
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => openBypassSheet(selected)}
                >
                  <ShieldOff size={16} /> Bypass Payment
                </Button>
              )}

              {/* Payment link */}
              {(selected.status === "needs_payment" || billing.amount > 0) && (
                <Button variant="outline" className="w-full gap-2" onClick={() => copyPaymentLink(selected)}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? "Link Copied!" : "Copy Payment Link"}
                </Button>
              )}

              {/* Book Another Stay */}
              {!["cancelled", "expired", "pending"].includes(selected.status) && (
                <Button variant="outline" className="w-full gap-1.5" onClick={() => openAddStayForGuest(selected)}>
                  <CalendarPlus size={16} /> Book Another Stay
                </Button>
              )}

              {/* Actions */}
              {selected.status !== "pending" && (
                <div className="flex gap-2">
                  <Button variant="ghost" className="flex-1 gap-1 text-danger" onClick={() => setConfirmAction({ action: () => handleDelete(selected), title: "Delete Guest?", description: `This will permanently delete ${selected.name}'s stay record.` })}>
                    <Trash2 size={16} /> Delete
                  </Button>
                  <Button variant="secondary" className="flex-1" onClick={() => openEdit(selected)}>
                    Edit Guest
                  </Button>
                </div>
              )}
            </div>
          );
        })()}
      </BottomSheet>

      {/* Admin Bypass Payment Sheet */}
      <BottomSheet open={showBypassSheet} onClose={() => { setShowBypassSheet(false); setBypassGuest(null); }} title="Admin Payment Override">
        {bypassGuest && (() => {
          const totalNights = Math.max(1, differenceInDays(bypassGuest.endDate, bypassGuest.startDate));
          const overrideAmount = overrideBillableDays * RATE_PER_DAY;
          return (
            <div className="flex flex-col gap-4">
              {bypassError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{bypassError}</div>
              )}

              {/* Stay info */}
              <div className="flex flex-col gap-1.5">
                {[
                  { label: "Guest", value: bypassGuest.name },
                  { label: "Plate", value: bypassGuest.plate },
                  { label: "Vehicle", value: bypassGuest.vehicle },
                  { label: "Dates", value: `${format(bypassGuest.startDate, "MM/dd")} – ${format(bypassGuest.endDate, "MM/dd")}` },
                  { label: "Total Nights", value: String(totalNights) },
                ].map((row) => (
                  <div key={row.label} className="flex justify-between text-sm">
                    <span className="text-text-secondary">{row.label}</span>
                    <span className="font-medium">{row.value || "—"}</span>
                  </div>
                ))}
              </div>

              {/* Override control */}
              <div className="bg-amber-50 border border-amber-200 rounded-[10px] p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={14} className="text-amber-600 shrink-0" />
                  <p className="text-xs font-semibold text-amber-700">Billable Days (Admin Override)</p>
                </div>
                <input
                  type="number"
                  min={0}
                  max={totalNights}
                  value={overrideBillableDays}
                  onChange={(e) => setOverrideBillableDays(Math.max(0, Math.min(totalNights, Number(e.target.value) || 0)))}
                  className="w-full h-10 rounded-lg bg-white border border-amber-300 text-sm text-center font-bold px-3 focus:outline-none focus:ring-2 focus:ring-amber-200"
                />
                <p className="text-[11px] text-amber-600">Set to 0 to approve without charge</p>
              </div>

              {/* Calculated total */}
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Rate</span>
                <span className="font-medium">${RATE_PER_DAY}/day</span>
              </div>
              <div className="flex justify-between text-sm border-t border-border pt-2">
                <span className="font-semibold">Total Amount</span>
                <span className="font-bold text-danger">${overrideAmount.toFixed(2)}</span>
              </div>

              {/* Action buttons */}
              <Button
                className="w-full gap-2"
                variant={overrideAmount === 0 ? "primary" : "danger"}
                loading={bypassLoading}
                onClick={handleBypassPayment}
              >
                <ShieldOff size={16} />
                {overrideAmount === 0 ? "Approve Without Charge" : `Bypass & Mark Paid ($${overrideAmount.toFixed(2)})`}
              </Button>

              <Button variant="outline" className="w-full gap-2" onClick={() => copyPaymentLink(bypassGuest)}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? "Link Copied!" : "Copy Payment Link"}
              </Button>
            </div>
          );
        })()}
      </BottomSheet>

      {/* Edit Guest Sheet */}
      <BottomSheet open={!!editingGuest} onClose={() => setEditingGuest(null)} title="Edit Guest">
        {editingGuest && (
          <form onSubmit={handleEdit} className="flex flex-col gap-3">
            {formError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{formError}</div>
            )}
            <Input label="Guest Name" icon={User} value={editForm.name} onChange={(e) => updateEdit("name", e.target.value)} required />
            <Input label="Email" icon={Mail} type="email" value={editForm.email} onChange={(e) => updateEdit("email", e.target.value)} />
            <Input label="License Plate" icon={Car} value={editForm.plate} onChange={(e) => updateEdit("plate", e.target.value)} required />
            <Input label="Vehicle" icon={Car} value={editForm.vehicle} onChange={(e) => updateEdit("vehicle", e.target.value)} />
            <DateRangePicker
              label="Stay Duration"
              startDate={editForm.startDate}
              endDate={editForm.endDate}
              onChange={(start, end) => setEditForm((f) => ({ ...f, startDate: start, endDate: end }))}
              required
            />
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
