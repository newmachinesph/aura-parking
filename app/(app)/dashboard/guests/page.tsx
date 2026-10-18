"use client";

import { useState, useEffect, useMemo } from "react";
import { useGuestStore, type Guest } from "@/stores/guestStore";
import { useAuthStore } from "@/stores/authStore";
import SearchBar from "@/components/ui/SearchBar";
import GuestCard from "@/components/shared/GuestCard";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import BottomSheet from "@/components/ui/BottomSheet";
import Input from "@/components/ui/Input";
import EmptyState from "@/components/ui/EmptyState";
import DateRangePicker from "@/components/ui/DateRangePicker";
import StripeCheckoutForm from "@/components/shared/StripeCheckout";
import ShowMoreButton from "@/components/ui/ShowMoreButton";
import { GuestCardSkeleton } from "@/components/ui/Skeleton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Plus, User, Car, Mail, Copy, Check, Trash2, CreditCard, Info, ShieldCheck, AlertCircle, Ticket, CalendarPlus, CheckCircle } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { RATE_PER_DAY } from "@/lib/constants";
import { useToast } from "@/components/ui/Toast";

export default function ResidentGuests() {
  const session = useAuthStore((s) => s.session);
  const {
    guests, search, setSearch, addGuest, updateGuest, deleteGuest, approveGuest,
    fetchGuests, fetchFreePass, freePass, isLoading, error, clearError,
    hasMore, isLoadingMore, fetchMoreGuests,
  } = useGuestStore();
  const residentId = session?.user.residentId;

  const [showAdd, setShowAdd] = useState(false);
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [editingGuest, setEditingGuest] = useState<Guest | null>(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({ name: "", plate: "", vehicle: "", email: "", startDate: "", endDate: "" });
  const [editForm, setEditForm] = useState({ name: "", plate: "", vehicle: "", email: "", startDate: "", endDate: "" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ action: () => Promise<void>; title: string; description: string } | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (residentId) {
      fetchGuests(residentId);
      fetchFreePass(residentId);
    }
  }, [residentId, fetchGuests, fetchFreePass]);

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
  const update = (key: string, val: string) => setForm((f) => ({ ...f, [key]: val }));
  const updateEdit = (key: string, val: string) => setEditForm((f) => ({ ...f, [key]: val }));

  const q = search.toLowerCase();
  const filtered = guests.filter(
    (g) =>
      !q ||
      g.name.toLowerCase().includes(q) ||
      g.plate.toLowerCase().includes(q) ||
      g.vehicle.toLowerCase().includes(q)
  );

  const sorted = [...filtered].sort((a, b) => {
    const order = { active: 0, approved: 1, pending: 2, needs_payment: 3, paid: 4, cancelled: 5, expired: 6 };
    return (order[a.status] ?? 9) - (order[b.status] ?? 9);
  });

  function getBillableInfo(guest: Guest) {
    const totalNights = Math.max(1, differenceInDays(guest.endDate, guest.startDate));
    if (guest.freePassUsed > 0 || guest.billableNights > 0 || guest.amountDue > 0 || guest.status !== "pending") {
      const vehicleFree = guest.guestFreePassNights || 0;
      const passesFromBalance = Math.max(0, guest.freePassUsed - vehicleFree);
      return {
        totalNights,
        freeDays: guest.freePassUsed,
        vehicleFree,
        passesFromBalance,
        billableDays: guest.billableNights,
        amount: guest.amountDue,
      };
    }
    const freeDays = freePass ? Math.min(freePass.remaining, totalNights) : 0;
    const billableDays = Math.max(0, totalNights - freeDays);
    return { totalNights, freeDays, vehicleFree: 0, passesFromBalance: freeDays, billableDays, amount: billableDays * RATE_PER_DAY };
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = form.name.trim();
    const trimmedPlate = form.plate.trim();
    const trimmedVehicle = form.vehicle.trim();
    if (!trimmedName) { setFormError("Guest name is required"); return; }
    if (!trimmedPlate) { setFormError("License plate is required"); return; }
    if (!/^[A-Za-z0-9]{2,8}$/.test(trimmedPlate.replace(/[\s-]/g, ""))) {
      setFormError("Please enter a valid US license plate (2-8 letters/numbers)");
      return;
    }
    if (!form.startDate || !form.endDate) { setFormError("Please select stay dates"); return; }
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await addGuest({
        name: trimmedName,
        plate: trimmedPlate,
        vehicle: trimmedVehicle,
        email: form.email.trim() || undefined,
        startDate: form.startDate,
        endDate: form.endDate,
      });
      const guestName = form.name;
      setForm({ name: "", plate: "", vehicle: "", email: "", startDate: "", endDate: "" });
      setShowAdd(false);
      if (residentId) fetchFreePass(residentId);

      if (result.status === "NEEDS_PAYMENT") {
        setPayingStayId(result.id);
      } else if (result.status === "APPROVED") {
        const b = result.billing as Record<string, number> | null;
        const passesUsed = (b?.guestFreePassApplied || 0) + (b?.bonusNightsApplied || 0) + (b?.freeNightsApplied || 0);
        setApprovedResult({ name: guestName, passesUsed });
      }
      toast({ title: "Guest added", variant: "success" });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to add guest");
      toast({ title: "Failed to add guest", description: err instanceof Error ? err.message : "Failed to add guest", variant: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (guest: Guest) => {
    setFormError(null);
    setEditingGuest(guest);
    setEditForm({
      name: guest.name,
      plate: guest.plate,
      vehicle: guest.vehicle,
      email: guest.email,
      startDate: format(guest.startDate, "yyyy-MM-dd"),
      endDate: format(guest.endDate, "yyyy-MM-dd"),
    });
    setSelectedGuest(null);
  };

  const openAddStayForGuest = (guest: Guest) => {
    setFormError(null);
    setForm({
      name: guest.name,
      plate: guest.plate,
      vehicle: guest.vehicle,
      email: guest.email,
      startDate: "",
      endDate: "",
    });
    setSelectedGuest(null);
    setShowAdd(true);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGuest) return;
    const trimmedName = editForm.name.trim();
    const trimmedPlate = editForm.plate.trim();
    const trimmedVehicle = editForm.vehicle.trim();
    if (!trimmedName) { setFormError("Guest name is required"); return; }
    if (!trimmedPlate) { setFormError("License plate is required"); return; }
    if (!/^[A-Za-z0-9]{2,8}$/.test(trimmedPlate.replace(/[\s-]/g, ""))) {
      setFormError("Please enter a valid US license plate (2-8 letters/numbers)");
      return;
    }
    if (!editForm.startDate || !editForm.endDate) { setFormError("Please select stay dates"); return; }
    setSubmitting(true);
    setFormError(null);
    try {
      await updateGuest(editingGuest.id, {
        name: trimmedName,
        plate: trimmedPlate,
        vehicle: trimmedVehicle,
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

  const handleDelete = async (guest: Guest) => {
    try {
      await deleteGuest(guest.id);
      setSelectedGuest(null);
      toast({ title: "Guest removed", variant: "success" });
    } catch {
      // handled by store
    }
  };

  const [approving, setApproving] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [payingStayId, setPayingStayId] = useState<number | null>(null);
  const [approvedResult, setApprovedResult] = useState<{ name: string; passesUsed: number } | null>(null);

  const handleApprove = async (guest: Guest) => {
    setApproving(true);
    setPayError(null);
    try {
      const result = await approveGuest(guest.id);
      if (residentId) fetchFreePass(residentId);

      if (result.status === "NEEDS_PAYMENT") {
        setSelectedGuest(null);
        setPayingStayId(guest.id);
      } else {
        const b = result.billing as Record<string, number> | null;
        const passesUsed = (b?.guestFreePassApplied || 0) + (b?.bonusNightsApplied || 0) + (b?.freeNightsApplied || 0);
        setSelectedGuest(null);
        setApprovedResult({ name: guest.name, passesUsed });
      }
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Failed to approve guest");
    } finally {
      setApproving(false);
    }
  };

  const handlePay = (guest: Guest) => {
    setSelectedGuest(null);
    setPayingStayId(guest.id);
  };

  const checkoutBody = useMemo(
    () => (payingStayId ? { stayId: payingStayId } : {}),
    [payingStayId]
  );

  const copyPaymentLink = async (guest: Guest) => {
    const url = `${window.location.origin}/payment?stayId=${guest.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Fallback for older browsers
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

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Guests</h1>
        <Button onClick={() => { setShowAdd(true); setFormError(null); }} className="gap-1.5 px-3 min-h-10 text-sm">
          <Plus size={16} /> Add
        </Button>
      </div>

      {/* Pass balance indicator */}
      {freePass && (
        <div className="flex items-center justify-between p-3 bg-primary-50 rounded-[10px]">
          <div>
            <p className="text-sm font-medium text-primary-700">Guest Passes</p>
            <p className="text-xs text-primary-500">
              {freePass.remaining} pass{freePass.remaining !== 1 ? "es" : ""} remaining
              {(freePass.monthlyRemaining > 0 || freePass.bonusPasses > 0) && (
                <> ({[
                  freePass.monthlyRemaining > 0 && `${freePass.monthlyRemaining} monthly`,
                  freePass.bonusPasses > 0 && `${freePass.bonusPasses} bonus`,
                ].filter(Boolean).join(" + ")})</>
              )}
            </p>
          </div>
          <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
            <span className="text-sm font-bold text-primary-700">{freePass.remaining}</span>
          </div>
        </div>
      )}

      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Search guests, plates..."
      />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">
          {error}
          <button onClick={clearError} className="ml-2 underline text-xs">Dismiss</button>
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <GuestCardSkeleton key={i} />)}</div>
      ) : sorted.length === 0 ? (
        <EmptyState title="No guests" description="Add a guest to get started" />
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((guest) => {
            const cost = guest.status === "pending" ? getBillableInfo(guest).amount : 0;
            return (
              <GuestCard
                key={guest.id}
                guest={guest}
                onTap={setSelectedGuest}
                onPay={guest.status === "needs_payment" ? handlePay : undefined}
                estimatedCost={cost > 0 ? cost : undefined}
              />
            );
          })}
        </div>
      )}

      <ShowMoreButton hasMore={hasMore} isLoading={isLoadingMore} onLoadMore={fetchMoreGuests} loadedCount={guests.length} />

      {/* Add Guest Sheet */}
      <BottomSheet open={showAdd} onClose={() => setShowAdd(false)} title="Add Guest">
        {(() => {
          const normalizedPlate = form.plate.trim().toUpperCase().replace(/[\s-]/g, "");
          const normalizedName = form.name.trim().toLowerCase();
          const now = new Date();
          const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

          const plateMatch = normalizedPlate.length >= 3 && guests.some(
            (g) => g.plate.toUpperCase().replace(/[\s-]/g, "") === normalizedPlate
          );
          const nameMatch = normalizedName.length >= 3 && guests.some(
            (g) => g.name.toLowerCase() === normalizedName
          );
          const staysThisMonth = guests.filter((g) => {
            const startMonth = format(g.startDate, "yyyy-MM");
            return startMonth === thisMonth && g.status !== "cancelled";
          }).length;

          return (
            <form onSubmit={handleAdd} className="flex flex-col gap-3">
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{formError}</div>
              )}

              {/* Guest recognition warning */}
              {(plateMatch || nameMatch) && (
                <div className="bg-blue-50 border border-blue-200 rounded-[10px] p-3 flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <Info size={14} className="text-blue-600 shrink-0" />
                    <p className="text-xs font-semibold text-blue-700">
                      {plateMatch ? "License plate recognized" : "Guest name recognized"}
                    </p>
                  </div>
                  <p className="text-[11px] text-blue-600">
                    {staysThisMonth} stay{staysThisMonth !== 1 ? "s" : ""} this month
                    {freePass ? ` · ${freePass.remaining} free night${freePass.remaining !== 1 ? "s" : ""} remaining` : ""}
                  </p>
                </div>
              )}

              <Input label="Guest Name" icon={User} placeholder="John Doe" value={form.name} onChange={(e) => update("name", e.target.value)} required />
              <Input label="Email" icon={Mail} type="email" placeholder="guest@email.com" value={form.email} onChange={(e) => update("email", e.target.value)} />
              <Input label="License Plate" icon={Car} placeholder="ABC-1234" value={form.plate} onChange={(e) => update("plate", e.target.value)} required />
              <Input label="Vehicle" icon={Car} placeholder="Toyota Corolla 2020" value={form.vehicle} onChange={(e) => update("vehicle", e.target.value)} />
              <DateRangePicker
                label="Stay Duration"
                startDate={form.startDate}
                endDate={form.endDate}
                onChange={(start, end) => setForm((f) => ({ ...f, startDate: start, endDate: end }))}
                min={today}
                required
              />
              <Button type="submit" loading={submitting} className="w-full mt-2">Add Guest</Button>
            </form>
          );
        })()}
      </BottomSheet>

      {/* Guest Detail Sheet */}
      <BottomSheet open={!!selectedGuest} onClose={() => setSelectedGuest(null)} title="Guest Details">
        {selectedGuest && (() => {
          const billing = getBillableInfo(selectedGuest);
          return (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                {[
                  { label: "Name", value: selectedGuest.name },
                  { label: "Vehicle", value: selectedGuest.vehicle },
                  { label: "Plate", value: selectedGuest.plate },
                  { label: "Email", value: selectedGuest.email },
                  { label: "Dates", value: `${format(selectedGuest.startDate, "MM/dd")} – ${format(selectedGuest.endDate, "MM/dd")}` },
                ].map((row) => (
                  <div key={row.label} className="flex justify-between text-sm">
                    <span className="text-text-secondary">{row.label}</span>
                    <span className="font-medium">{row.value || "—"}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm items-center">
                  <span className="text-text-secondary">Status</span>
                  <div className="flex flex-col items-end gap-0.5">
                    <Badge variant={
                      selectedGuest.status === "active" || selectedGuest.status === "approved" ? "success" :
                      selectedGuest.status === "needs_payment" ? "danger" :
                      selectedGuest.status === "pending" ? "warning" : "neutral"
                    }>{selectedGuest.status.replace("_", " ")}</Badge>
                    <span className="text-[11px] text-text-secondary">
                      {selectedGuest.status === "active" && "Guest is currently parked"}
                      {selectedGuest.status === "approved" && "Approved — no payment required"}
                      {selectedGuest.status === "pending" && "Waiting for your approval"}
                      {selectedGuest.status === "needs_payment" && "Approved — guest payment required"}
                      {selectedGuest.status === "paid" && "Payment received — stay confirmed"}
                      {selectedGuest.status === "cancelled" && "Stay was cancelled"}
                      {selectedGuest.status === "expired" && "Stay period has ended"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Billing breakdown */}
              <div className="bg-surface-dim rounded-[10px] p-3 flex flex-col gap-1.5">
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Billing</p>
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Total nights</span>
                  <span className="font-medium">{billing.totalNights}</span>
                </div>
                {billing.vehicleFree > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Vehicle free night</span>
                    <span className="font-medium text-success">-{billing.vehicleFree}</span>
                  </div>
                )}
                {billing.passesFromBalance > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Passes from balance</span>
                    <span className="font-medium text-success">-{billing.passesFromBalance} night{billing.passesFromBalance !== 1 ? "s" : ""}</span>
                  </div>
                )}
                {billing.billableDays > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Billable nights</span>
                    <span className="font-medium">{billing.billableDays} × ${RATE_PER_DAY}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm border-t border-border pt-1.5">
                  <span className="font-semibold">Total</span>
                  <span className="font-bold">{billing.amount > 0 ? `$${billing.amount.toFixed(2)}` : "Free"}</span>
                </div>
              </div>

              {/* Pending: residents can approve */}
              {selectedGuest.status === "pending" && (() => {
                const needsPayment = billing.amount > 0;
                return (
                  <div className="flex flex-col gap-3">
                    {/* Pass status indicator */}
                    <div className={`rounded-[10px] p-3 flex flex-col gap-1.5 ${needsPayment ? "bg-amber-50 border border-amber-200" : "bg-green-50 border border-green-200"}`}>
                      <div className="flex items-center gap-2">
                        {needsPayment ? (
                          <AlertCircle size={15} className="text-amber-600 shrink-0" />
                        ) : (
                          <Ticket size={15} className="text-green-600 shrink-0" />
                        )}
                        <span className={`text-xs font-semibold ${needsPayment ? "text-amber-700" : "text-green-700"}`}>
                          {needsPayment
                            ? "Payment required after approval"
                            : billing.freeDays > 0
                              ? `${billing.freeDays} pass${billing.freeDays !== 1 ? "es" : ""} will be applied — no payment needed`
                              : "No payment needed"}
                        </span>
                      </div>
                      {needsPayment && (
                        <p className="text-[11px] text-amber-600">
                          This stay costs ${billing.amount.toFixed(2)}. You can pay online after approving.
                        </p>
                      )}
                    </div>

                    {/* Approve button */}
                    <Button
                      className="w-full gap-2"
                      onClick={() => handleApprove(selectedGuest)}
                      loading={approving}
                    >
                      {needsPayment ? (
                        <><CreditCard size={16} /> Approve & Pay ${billing.amount.toFixed(2)}</>
                      ) : (
                        <><ShieldCheck size={16} /> Approve Guest</>
                      )}
                    </Button>
                  </div>
                );
              })()}

              {/* Payment actions */}
              {payError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{payError}</div>
              )}
              {selectedGuest.status === "needs_payment" && (
                <Button className="w-full gap-2" onClick={() => handlePay(selectedGuest)}>
                  <CreditCard size={16} /> Pay Now
                </Button>
              )}
              {(selectedGuest.status === "needs_payment" || billing.amount > 0) && (
                <Button variant="outline" className="w-full gap-2" onClick={() => copyPaymentLink(selectedGuest)}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? "Link Copied!" : "Copy Payment Link"}
                </Button>
              )}

              {/* Action buttons */}
              <div className="flex flex-col gap-2">
                {selectedGuest.status !== "cancelled" && selectedGuest.status !== "expired" && selectedGuest.status !== "pending" && (
                  <Button
                    variant="outline"
                    className="w-full gap-1.5"
                    onClick={() => openAddStayForGuest(selectedGuest)}
                  >
                    <CalendarPlus size={16} /> Book Another Stay
                  </Button>
                )}
                <div className="flex gap-2">
                  {selectedGuest.status === "pending" && (
                    <Button variant="ghost" className="flex-1 gap-1 text-danger" onClick={() => setConfirmAction({ action: () => handleDelete(selectedGuest), title: "Reject Guest?", description: `This will reject and remove ${selectedGuest.name}'s stay request.` })}>
                      <Trash2 size={16} /> Reject
                    </Button>
                  )}
                  {(selectedGuest.status === "pending" || selectedGuest.status === "approved" || selectedGuest.status === "active") && (
                    <Button variant="secondary" className="flex-1" onClick={() => openEdit(selectedGuest)}>
                      Edit Guest
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </BottomSheet>

      {/* Stripe embedded checkout sheet */}
      <BottomSheet
        open={!!payingStayId}
        onClose={() => setPayingStayId(null)}
        title="Complete Payment"
      >
        {payingStayId && (
          <StripeCheckoutForm
            endpoint="/api/checkout-session"
            body={checkoutBody}
            onNoPaymentRequired={() => {
              if (residentId) {
                fetchGuests(residentId);
                fetchFreePass(residentId);
              }
            }}
          />
        )}
      </BottomSheet>

      {/* Approved success sheet */}
      <BottomSheet open={!!approvedResult} onClose={() => setApprovedResult(null)} title="Guest Approved">
        {approvedResult && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle size={28} className="text-green-600" />
            </div>
            <p className="font-bold text-lg">{approvedResult.name} Approved!</p>
            <p className="text-sm text-text-secondary">
              {approvedResult.passesUsed > 0
                ? `${approvedResult.passesUsed} pass${approvedResult.passesUsed !== 1 ? "es" : ""} applied — no payment needed.`
                : "Guest has been approved for parking."}
            </p>
            <Button className="w-full mt-2" onClick={() => setApprovedResult(null)}>Done</Button>
          </div>
        )}
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
              min={today}
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
