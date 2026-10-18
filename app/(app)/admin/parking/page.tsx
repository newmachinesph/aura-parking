"use client";

import { useState, useRef, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useParkingStore, type Vehicle, type TabKey } from "@/stores/parkingStore";
import SearchBar from "@/components/ui/SearchBar";
import StatsCard from "@/components/ui/StatsCard";
import TabBar from "@/components/ui/TabBar";
import VehicleCard from "@/components/shared/VehicleCard";
import BottomSheet from "@/components/ui/BottomSheet";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import EmptyState from "@/components/ui/EmptyState";
import ShowMoreButton from "@/components/ui/ShowMoreButton";
import { VehicleCardSkeleton } from "@/components/ui/Skeleton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Car, CarFront, AlertTriangle, Clock, Plus, Camera, X, ArrowRight, Trash2, CheckCircle, ShieldAlert, Loader2, Mail, Send, Pencil, Expand } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { differenceInDays } from "date-fns";
import { useUploadThing } from "@/lib/uploadthing";
import { useToast } from "@/components/ui/Toast";

function getRecommendedAction(vehicle: Vehicle) {
  if (vehicle.status !== "unauthorized") return null;
  const daysParked = vehicle.reportedAt
    ? differenceInDays(new Date(), vehicle.reportedAt)
    : 0;
  if (daysParked <= 1) return { label: "Monitor", description: "Vehicle reported recently — monitor for 24 hours", color: "warning" as const };
  if (daysParked <= 3) return { label: "Sticker", description: "Place a warning sticker on the vehicle windshield", color: "warning" as const };
  return { label: "Tow", description: "Vehicle has been unauthorized for 4+ days — recommend towing", color: "danger" as const };
}

export default function AdminParking() {
  const {
    search, setSearch, activeTab, setActiveTab, getStats, getFilteredVehicles,
    addUnauthorized, removeVehicle, resolveVehicle, fetchVehicles, isLoading, error,
    hasMore, isLoadingMore, fetchMoreVehicles,
  } = useParkingStore();
  const stats = getStats();
  const unsortedVehicles = getFilteredVehicles();
  const statusOrder: Record<string, number> = { active: 0, expired: 1, unauthorized: 2 };
  const vehicles = [...unsortedVehicles].sort((a, b) => {
    const s = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
    if (s !== 0) return s;
    const dateA = a.startDate ?? a.reportedAt ?? new Date(0);
    const dateB = b.startDate ?? b.reportedAt ?? new Date(0);
    return new Date(dateB).getTime() - new Date(dateA).getTime();
  });
  const [selected, setSelected] = useState<Vehicle | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ plate: "", vehicle: "", location: "", notes: "" });
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const { startUpload, isUploading } = useUploadThing("vehicleImage");
  const [towPhase, setTowPhase] = useState<"idle" | "form" | "sending" | "sent" | "error">("idle");
  const [towEmail, setTowEmail] = useState("");
  const [towError, setTowError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ action: () => Promise<void>; title: string; description: string } | null>(null);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [editForm, setEditForm] = useState({ plate: "", vehicle: "", location: "", notes: "" });
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const { toast } = useToast();
  const [expandedPhoto, setExpandedPhoto] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => { fetchVehicles(); }, [fetchVehicles]);

  // Read tab from URL (?tab=unauthorized)
  useEffect(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab && ["all", "active", "expired", "unauthorized"].includes(urlTab)) {
      setActiveTab(urlTab as TabKey);
      router.replace("/admin/parking", { scroll: false });
    }
  }, [searchParams, router, setActiveTab]);

  const update = (key: string, val: string) => setForm((f) => ({ ...f, [key]: val }));

  const tabs = [
    { key: "all", label: "All", icon: CarFront, count: stats.active + stats.expired + stats.unauthorized },
    { key: "active", label: "Active", icon: CheckCircle, count: stats.active },
    { key: "expired", label: "Expired", icon: AlertTriangle, count: stats.expired },
    { key: "unauthorized", label: "Unauthorized", icon: ShieldAlert, count: stats.unauthorized },
  ];

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setPhotoPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleAddUnauthorized = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      let imageUrl: string | undefined;
      const file = cameraInputRef.current?.files?.[0] || fileInputRef.current?.files?.[0];
      if (file) {
        const res = await startUpload([file]);
        if (res?.[0]?.ufsUrl) imageUrl = res[0].ufsUrl;
      }
      await addUnauthorized({
        plate: form.plate,
        vehicleMake: form.vehicle,
        notes: form.notes,
        location: form.location,
        imageUrl,
      });
      setForm({ plate: "", vehicle: "", location: "", notes: "" });
      setPhotoPreview(null);
      setShowAdd(false);
      toast({ title: "Vehicle reported", variant: "success" });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to report vehicle");
      toast({ title: "Failed to report", description: err instanceof Error ? err.message : "Failed to report vehicle", variant: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendTowWarning = async (vehicle: Vehicle) => {
    if (!towEmail) return;
    setTowPhase("sending");
    try {
      await apiFetch("/api/tow-warnings", {
        method: "POST",
        body: JSON.stringify({
          toEmail: towEmail,
          vehiclePlate: vehicle.plate,
          vehicleDesc: vehicle.vehicle,
          unitNumber: vehicle.unit !== "\u2014" ? vehicle.unit : "",
          actionUrl: `${window.location.origin}/register`,
        }),
      });
      setTowPhase("sent");
      toast({ title: "Tow warning sent", variant: "success" });
    } catch (err) {
      setTowError(err instanceof ApiError ? err.message : "Failed to send tow warning");
      setTowPhase("error");
    }
  };

  const handleMarkUnauthorized = async (vehicle: Vehicle) => {
    try {
      await addUnauthorized({
        plate: vehicle.plate,
        vehicleMake: vehicle.vehicle,
        notes: "Previously expired guest — converted to unauthorized",
        location: "",
      });
      setSelected(null);
    } catch {
      // handled by store
    }
  };

  const handleResolve = async (vehicle: Vehicle) => {
    try {
      await resolveVehicle(vehicle.id);
      setSelected(null);
      toast({ title: "Vehicle resolved", variant: "success" });
    } catch {
      // handled by store
    }
  };

  const handleRemove = async (vehicle: Vehicle) => {
    try {
      await removeVehicle(vehicle.id);
      setSelected(null);
      toast({ title: "Vehicle removed", variant: "success" });
    } catch {
      // handled by store
    }
  };

  const openEditVehicle = (v: Vehicle) => {
    setEditingVehicle(v);
    setEditForm({ plate: v.plate, vehicle: v.vehicle, location: v.location || "", notes: v.notes || "" });
    setEditError(null);
    setSelected(null);
  };

  const handleEditVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVehicle) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      // Parse vehicle description into make + color
      const parts = editForm.vehicle.split(" ");
      const color = parts[0] || "";
      const make = parts.slice(1).join(" ") || editForm.vehicle;
      await apiFetch(`/api/unauthorized-vehicles/${editingVehicle.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          plateNumber: editForm.plate,
          vehicleMake: make,
          vehicleColor: color,
          spottedLocation: editForm.location || null,
          violationNote: editForm.notes || null,
        }),
      });
      setEditingVehicle(null);
      await fetchVehicles();
      toast({ title: "Vehicle updated", variant: "success" });
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Failed to update");
    } finally {
      setEditSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 py-4">
      <div>
        <h1 className="text-xl font-bold">Parking</h1>
        <p className="text-sm text-text-secondary mt-0.5">Verify parked vehicles against active guest list. Flag unauthorized vehicles for action.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatsCard title="Active Guests" value={stats.active} accent="success" icon={Car} />
        <StatsCard title="Expired (48h)" value={stats.expired} accent="warning" icon={Clock} />
        <StatsCard title="Unauthorized" value={stats.unauthorized} accent="danger" icon={AlertTriangle} />
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1">
          <SearchBar value={search} onChange={setSearch} placeholder="Search plate, name, unit, or vehicle..." />
        </div>
        <Button onClick={() => { setShowAdd(true); setFormError(null); }} className="gap-1.5 px-3 min-h-10 text-sm shrink-0" variant="danger">
          <Plus size={16} /> Report
        </Button>
      </div>
      <TabBar tabs={tabs} active={activeTab} onChange={(k) => setActiveTab(k as TabKey)} />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{error}</div>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <VehicleCardSkeleton key={i} />)}</div>
      ) : vehicles.length === 0 ? (
        <EmptyState title="No vehicles" description="No vehicles in this category" />
      ) : (
        <div className="flex flex-col gap-2">
          {vehicles.map((v) => (
            <VehicleCard
              key={`${v._isUnauthorized ? "u" : "g"}-${v.id}`}
              vehicle={v}
              onClick={setSelected}
              onDelete={v._isUnauthorized ? (vehicle) => setConfirmAction({ action: () => handleRemove(vehicle), title: "Delete Vehicle?", description: `This will permanently remove the record for ${vehicle.plate}.` }) : undefined}
            />
          ))}
        </div>
      )}

      <ShowMoreButton hasMore={hasMore} isLoading={isLoadingMore} onLoadMore={fetchMoreVehicles} />

      {/* Vehicle detail */}
      <BottomSheet open={!!selected} onClose={() => { setSelected(null); setTowPhase("idle"); setTowEmail(""); setTowError(null); }} title="Vehicle Details">
        {selected && (() => {
          const action = getRecommendedAction(selected);
          return (
            <div className="flex flex-col gap-3">
              {selected.photoUrl && (
                <button type="button" onClick={() => setExpandedPhoto(selected.photoUrl!)} className="relative rounded-[10px] overflow-hidden border border-border group cursor-pointer">
                  <img src={selected.photoUrl} alt="Vehicle photo" className="w-full h-48 object-cover" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <div className="bg-black/60 text-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Expand size={18} />
                    </div>
                  </div>
                </button>
              )}
              {[
                { label: "Plate", value: selected.plate },
                { label: "Vehicle", value: selected.vehicle },
                { label: "Owner", value: selected.name },
                { label: "Unit", value: selected.unit },
                ...(selected.location ? [{ label: "Location", value: selected.location }] : []),
                ...(selected.notes ? [{ label: "Notes", value: selected.notes }] : []),
              ].map((row) => (
                <div key={row.label} className="flex justify-between text-sm">
                  <span className="text-text-secondary">{row.label}</span>
                  <span className="font-medium capitalize">{row.value}</span>
                </div>
              ))}
              <div className="flex justify-between text-sm items-center">
                <span className="text-text-secondary">Status</span>
                <Badge variant={selected.status === "active" ? "success" : selected.status === "expired" ? "warning" : "danger"}>
                  {selected.status}
                </Badge>
              </div>

              {action && (
                <div className={`flex flex-col gap-1.5 p-3 rounded-[10px] ${action.color === "danger" ? "bg-red-50" : "bg-amber-50"}`}>
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={16} className={action.color === "danger" ? "text-danger" : "text-warning"} />
                    <p className="text-sm font-semibold">{action.label}</p>
                  </div>
                  <p className="text-xs text-text-secondary">{action.description}</p>
                </div>
              )}

              {action?.label === "Tow" && (
                towPhase === "sent" ? (
                  <div className="flex items-center gap-2 p-3 bg-green-50 rounded-[10px] border border-green-200">
                    <CheckCircle size={16} className="text-green-600" />
                    <p className="text-sm font-medium text-green-700">Tow warning email sent</p>
                  </div>
                ) : towPhase === "form" || towPhase === "sending" || towPhase === "error" ? (
                  <div className="flex flex-col gap-2 p-3 bg-red-50 rounded-[10px] border border-red-200">
                    <p className="text-sm font-medium">Send tow warning to vehicle owner</p>
                    <Input
                      placeholder="owner@email.com"
                      type="email"
                      icon={Mail}
                      value={towEmail}
                      onChange={(e) => setTowEmail(e.target.value)}
                    />
                    {towPhase === "error" && towError && (
                      <p className="text-xs text-red-600">{towError}</p>
                    )}
                    <div className="flex gap-2">
                      <Button variant="secondary" className="flex-1" onClick={() => { setTowPhase("idle"); setTowError(null); }}>Cancel</Button>
                      <Button variant="danger" className="flex-1 gap-1" loading={towPhase === "sending"} onClick={() => handleSendTowWarning(selected)}>
                        <Send size={14} /> Send
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="danger" className="w-full gap-2" onClick={() => setTowPhase("form")}>
                    <Mail size={16} /> Send Tow Warning Email
                  </Button>
                )
              )}

              {selected.status === "expired" && (
                <Button variant="danger" className="w-full gap-2" onClick={() => handleMarkUnauthorized(selected)}>
                  <ArrowRight size={16} /> Mark as Unauthorized
                </Button>
              )}

              {selected._isUnauthorized && (
                <>
                  <Button variant="outline" className="w-full gap-1.5" onClick={() => openEditVehicle(selected)}>
                    <Pencil size={16} /> Edit Details
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="ghost" className="flex-1 gap-1 text-danger" onClick={() => setConfirmAction({ action: () => handleRemove(selected), title: "Delete Vehicle?", description: `This will permanently remove the record for ${selected.plate}.` })}>
                      <Trash2 size={16} /> Delete
                    </Button>
                    <Button variant="secondary" className="flex-1 gap-1" onClick={() => setConfirmAction({ action: () => handleResolve(selected), title: "Resolve Vehicle?", description: `Mark ${selected.plate} as resolved. This cannot be undone.` })}>
                      <CheckCircle size={16} /> Resolve
                    </Button>
                  </div>
                </>
              )}
            </div>
          );
        })()}
      </BottomSheet>

      {/* Add unauthorized */}
      <BottomSheet open={showAdd} onClose={() => setShowAdd(false)} title="Report Unauthorized Vehicle">
        <form onSubmit={handleAddUnauthorized} className="flex flex-col gap-3">
          {formError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{formError}</div>
          )}
          <Input label="License Plate" placeholder="UNK-0001" value={form.plate} onChange={(e) => update("plate", e.target.value)} required />
          <Input label="Vehicle Description" placeholder="Red Sedan" value={form.vehicle} onChange={(e) => update("vehicle", e.target.value)} required />
          <Input label="Location (optional)" placeholder="Lot B, Spot 12" value={form.location} onChange={(e) => update("location", e.target.value)} />
          <Input label="Notes" placeholder="No permit visible" value={form.notes} onChange={(e) => update("notes", e.target.value)} />

          <div>
            {photoPreview ? (
              <div className="relative rounded-[10px] overflow-hidden border border-border">
                <img src={photoPreview} alt="Preview" className="w-full h-40 object-cover" />
                <button
                  type="button"
                  onClick={() => { setPhotoPreview(null); if (fileInputRef.current) fileInputRef.current.value = ""; if (cameraInputRef.current) cameraInputRef.current.value = ""; }}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex items-center gap-2 flex-1 p-3 bg-surface-dim rounded-[10px] cursor-pointer hover:bg-gray-100 transition-colors"
                >
                  <Camera size={18} className="text-text-secondary" />
                  <span className="text-sm text-text-secondary">Take Photo</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 flex-1 p-3 bg-surface-dim rounded-[10px] cursor-pointer hover:bg-gray-100 transition-colors"
                >
                  <Camera size={18} className="text-text-secondary" />
                  <span className="text-sm text-text-secondary">Library</span>
                </button>
              </div>
            )}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handlePhotoChange}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoChange}
            />
          </div>

          <Button type="submit" variant="danger" loading={submitting || isUploading} className="w-full mt-2">
            {isUploading ? <><Loader2 size={16} className="animate-spin" /> Uploading Photo...</> : "Report Vehicle"}
          </Button>
        </form>
      </BottomSheet>

      {/* Edit unauthorized vehicle */}
      <BottomSheet open={!!editingVehicle} onClose={() => setEditingVehicle(null)} title="Edit Vehicle">
        {editingVehicle && (
          <form onSubmit={handleEditVehicle} className="flex flex-col gap-3">
            {editError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{editError}</div>
            )}
            <Input label="License Plate" value={editForm.plate} onChange={(e) => setEditForm((f) => ({ ...f, plate: e.target.value }))} required />
            <Input label="Vehicle Description" value={editForm.vehicle} onChange={(e) => setEditForm((f) => ({ ...f, vehicle: e.target.value }))} required />
            <Input label="Location" value={editForm.location} onChange={(e) => setEditForm((f) => ({ ...f, location: e.target.value }))} />
            <Input label="Notes" value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} />
            <Button type="submit" loading={editSubmitting} className="w-full mt-2">Save Changes</Button>
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

      {/* Fullscreen photo viewer */}
      {expandedPhoto && (
        <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4" onClick={() => setExpandedPhoto(null)}>
          <button type="button" onClick={() => setExpandedPhoto(null)} className="absolute top-4 right-4 bg-white/20 hover:bg-white/30 transition-colors rounded-full p-2 text-white">
            <X size={24} />
          </button>
          <img src={expandedPhoto} alt="Vehicle photo" className="max-w-full max-h-full object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
