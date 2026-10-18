"use client";

import { useState, useEffect, useCallback } from "react";
import SearchBar from "@/components/ui/SearchBar";
import StatsCard from "@/components/ui/StatsCard";
import Card from "@/components/ui/Card";
import BottomSheet from "@/components/ui/BottomSheet";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import EmptyState from "@/components/ui/EmptyState";
import ShowMoreButton from "@/components/ui/ShowMoreButton";
import Skeleton from "@/components/ui/Skeleton";
import Badge from "@/components/ui/Badge";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { apiFetch, ApiError } from "@/lib/api";
import { Building, Users, Home, Plus, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

interface Unit {
  id: number;
  unit_number: string;
  building_code: string | null;
  active_residents: number;
  total_residents: number;
  created_at: string;
}

export default function AdminUnits() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const { toast } = useToast();

  // Add state
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ unitNumber: "", buildingCode: "" });
  const [addError, setAddError] = useState<string | null>(null);
  const [addSubmitting, setAddSubmitting] = useState(false);

  // Edit state
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [editForm, setEditForm] = useState({ unitNumber: "", buildingCode: "" });
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Delete confirm
  const [confirmAction, setConfirmAction] = useState<{ action: () => Promise<void>; title: string; description: string } | null>(null);

  const loadUnits = useCallback(async () => {
    try {
      const data = await apiFetch<{ units: Unit[]; hasMore: boolean; nextCursor: number | null }>("/api/admin/units");
      setUnits(data.units);
      setHasMore(data.hasMore ?? false);
      setNextCursor(data.nextCursor ?? null);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUnits(); }, [loadUnits]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const data = await apiFetch<{ units: Unit[]; hasMore: boolean; nextCursor: number | null }>(
        `/api/admin/units?cursor=${nextCursor}&limit=50`
      );
      setUnits((prev) => [...prev, ...data.units]);
      setHasMore(data.hasMore ?? false);
      setNextCursor(data.nextCursor ?? null);
    } catch {
      // silent
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, nextCursor]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddSubmitting(true);
    setAddError(null);
    try {
      await apiFetch("/api/admin/units", {
        method: "POST",
        body: JSON.stringify({ unitNumber: addForm.unitNumber, buildingCode: addForm.buildingCode || undefined }),
      });
      setShowAdd(false);
      setAddForm({ unitNumber: "", buildingCode: "" });
      loadUnits();
      toast({ title: "Unit created", variant: "success" });
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "Failed to create unit");
    } finally {
      setAddSubmitting(false);
    }
  };

  const openEdit = (unit: Unit) => {
    setEditingUnit(unit);
    setEditForm({ unitNumber: unit.unit_number, buildingCode: unit.building_code || "" });
    setEditError(null);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUnit) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      await apiFetch(`/api/admin/units/${editingUnit.id}`, {
        method: "PATCH",
        body: JSON.stringify({ unitNumber: editForm.unitNumber, buildingCode: editForm.buildingCode || null }),
      });
      setEditingUnit(null);
      loadUnits();
      toast({ title: "Unit updated", variant: "success" });
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Failed to update unit");
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDelete = async (unit: Unit) => {
    try {
      await apiFetch(`/api/admin/units/${unit.id}`, { method: "DELETE" });
      setUnits((prev) => prev.filter((u) => u.id !== unit.id));
      toast({ title: "Unit deleted", variant: "success" });
    } catch (err) {
      toast({ title: "Cannot delete unit", description: err instanceof ApiError ? err.message : "Failed to delete", variant: "error" });
    }
  };

  const occupiedCount = units.filter((u) => Number(u.active_residents) > 0).length;
  const vacantCount = units.filter((u) => Number(u.active_residents) === 0).length;

  const q = search.toLowerCase();
  const filtered = units.filter(
    (u) =>
      !q ||
      u.unit_number.toLowerCase().includes(q) ||
      (u.building_code || "").toLowerCase().includes(q)
  );

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Units</h1>
          <p className="text-sm text-text-secondary mt-0.5">All registered units and their resident occupancy.</p>
        </div>
        {/* Add Unit button hidden for now */}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatsCard title="Total Units" value={units.length} accent="primary" icon={Building} />
        <StatsCard title="Occupied" value={occupiedCount} accent="success" icon={Users} />
        <StatsCard title="Vacant" value={vacantCount} accent="warning" icon={Home} />
      </div>

      <SearchBar value={search} onChange={setSearch} placeholder="Search by unit number..." />

      {loading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState title="No units" description="No units match your search" />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((unit) => {
            const active = Number(unit.active_residents);
            const total = Number(unit.total_residents);
            return (
              <Card key={unit.id}>
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
                    <button
                      title="Edit"
                      onClick={(e) => { e.stopPropagation(); openEdit(unit); }}
                      className="p-1.5 rounded-md hover:bg-primary-50 transition-colors text-text-secondary hover:text-primary-500 cursor-pointer"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      title="Delete"
                      onClick={(e) => { e.stopPropagation(); setConfirmAction({ action: () => handleDelete(unit), title: "Delete Unit?", description: `Delete Unit ${unit.unit_number}? This cannot be undone.` }); }}
                      className="p-1.5 rounded-md hover:bg-red-50 transition-colors text-text-secondary hover:text-red-500 cursor-pointer"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ShowMoreButton hasMore={hasMore} isLoading={loadingMore} onLoadMore={loadMore} loadedCount={units.length} />

      {/* Add Unit Sheet */}
      <BottomSheet open={showAdd} onClose={() => setShowAdd(false)} title="Add Unit">
        <form onSubmit={handleAdd} className="flex flex-col gap-3">
          {addError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{addError}</div>
          )}
          <Input label="Unit Number" icon={Building} placeholder="A-101" value={addForm.unitNumber} onChange={(e) => setAddForm((f) => ({ ...f, unitNumber: e.target.value }))} required />
          <Input label="Building Code" icon={Building} placeholder="A (optional)" value={addForm.buildingCode} onChange={(e) => setAddForm((f) => ({ ...f, buildingCode: e.target.value }))} />
          <Button type="submit" loading={addSubmitting} className="w-full mt-2">Create Unit</Button>
        </form>
      </BottomSheet>

      {/* Edit Unit Sheet */}
      <BottomSheet open={!!editingUnit} onClose={() => setEditingUnit(null)} title="Edit Unit">
        {editingUnit && (
          <form onSubmit={handleEdit} className="flex flex-col gap-3">
            {editError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{editError}</div>
            )}
            <Input label="Unit Number" icon={Building} value={editForm.unitNumber} onChange={(e) => setEditForm((f) => ({ ...f, unitNumber: e.target.value }))} required />
            <Input label="Building Code" icon={Building} placeholder="Optional" value={editForm.buildingCode} onChange={(e) => setEditForm((f) => ({ ...f, buildingCode: e.target.value }))} />
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
    </div>
  );
}
