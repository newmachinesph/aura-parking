"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import SearchBar from "@/components/ui/SearchBar";
import StatsCard from "@/components/ui/StatsCard";
import TabBar from "@/components/ui/TabBar";
import Card from "@/components/ui/Card";
import BottomSheet from "@/components/ui/BottomSheet";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import EmptyState from "@/components/ui/EmptyState";
import ShowMoreButton from "@/components/ui/ShowMoreButton";
import Skeleton from "@/components/ui/Skeleton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { apiFetch, ApiError } from "@/lib/api";
import {
  ShieldCheck, Wrench, Clock, Users, Plus, Trash2,
  Pencil, CheckCircle, User, Mail, Lock, Building, Home,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";

interface AdminUser {
  id: number;
  email: string;
  role: "admin" | "staff" | "resident";
  status: "ACTIVE" | "INACTIVE";
  full_name: string | null;
  unit_number: string | null;
  created_at: string;
}

type Tab = "all" | "admin" | "staff" | "pending";

export default function AdminUsers() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("all");

  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [confirmActivateId, setConfirmActivateId] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ action: () => Promise<void>; title: string; description: string } | null>(null);

  const [addForm, setAddForm] = useState({ fullName: "", email: "", password: "", role: "staff" as string, unitNumber: "" });
  const [editForm, setEditForm] = useState({ email: "", role: "staff" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { toast } = useToast();

  const loadUsers = useCallback(async () => {
    try {
      setFetchError(null);
      const data = await apiFetch<{ users: AdminUser[]; hasMore: boolean; nextCursor: number | null }>("/api/admin/users");
      setUsers(data.users);
      setHasMore(data.hasMore ?? false);
      setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      setFetchError(err instanceof ApiError ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMoreUsers = useCallback(async () => {
    if (!hasMore || loadingMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const data = await apiFetch<{ users: AdminUser[]; hasMore: boolean; nextCursor: number | null }>(
        `/api/admin/users?cursor=${nextCursor}&limit=50`
      );
      setUsers((prev) => [...prev, ...data.users]);
      setHasMore(data.hasMore ?? false);
      setNextCursor(data.nextCursor ?? null);
    } catch {
      // silent
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, nextCursor]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  // Auto-open add modal from nav link (?add=true) or set tab from URL (?tab=pending)
  useEffect(() => {
    const urlTab = searchParams.get("tab");
    if (searchParams.get("add") === "true") {
      setShowAdd(true);
      setFormError(null);
      router.replace("/admin/users", { scroll: false });
    } else if (urlTab && ["all", "admin", "staff", "pending"].includes(urlTab)) {
      setTab(urlTab as Tab);
      router.replace("/admin/users", { scroll: false });
    }
  }, [searchParams, router]);

  // Exclude residents from the list (they are managed on the Residents page)
  const nonResidentUsers = users.filter((u) => u.role !== "resident");

  // Stats
  const admins = nonResidentUsers.filter((u) => u.role === "admin").length;
  const staff = nonResidentUsers.filter((u) => u.role === "staff").length;
  const pending = nonResidentUsers.filter((u) => u.status === "INACTIVE").length;

  // Tabs
  const tabs = [
    { key: "all", label: "All", icon: Users, count: nonResidentUsers.length },
    { key: "admin", label: "Admin", icon: ShieldCheck, count: admins },
    { key: "staff", label: "Staff", icon: Wrench, count: staff },
    { key: "pending", label: "Pending", icon: Clock, count: pending },
  ];

  // Filtering
  const tabFiltered = nonResidentUsers.filter((u) => {
    if (tab === "admin") return u.role === "admin";
    if (tab === "staff") return u.role === "staff";
    if (tab === "pending") return u.status === "INACTIVE";
    return true;
  });
  const q = search.toLowerCase();
  const filtered = tabFiltered.filter(
    (u) =>
      !q ||
      u.email.toLowerCase().includes(q) ||
      (u.full_name?.toLowerCase() ?? "").includes(q) ||
      u.role.includes(q)
  );

  // Handlers
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await apiFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: addForm.email,
          password: addForm.password,
          role: addForm.role,
          fullName: addForm.fullName,
          ...(addForm.role === "resident" ? { unitNumber: addForm.unitNumber } : {}),
        }),
      });
      setShowAdd(false);
      setAddForm({ fullName: "", email: "", password: "", role: "staff", unitNumber: "" });
      await loadUsers();
      toast({ title: "User created", variant: "success" });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create user");
      toast({ title: "Failed to create user", description: err instanceof ApiError ? err.message : "Failed to create user", variant: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (user: AdminUser) => {
    setEditForm({ email: user.email, role: user.role });
    setEditingUser(user);
    setFormError(null);
    setSelected(null);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await apiFetch(`/api/admin/users/${editingUser.id}`, {
        method: "PATCH",
        body: JSON.stringify({ email: editForm.email, role: editForm.role }),
      });
      setEditingUser(null);
      await loadUsers();
      toast({ title: "User updated", variant: "success" });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to update user");
      toast({ title: "Failed to update user", description: err instanceof ApiError ? err.message : "Failed to update user", variant: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (user: AdminUser) => {
    setSubmitting(true);
    try {
      await apiFetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      setSelected(null);
      setConfirmDeleteId(null);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      toast({ title: "User deleted", variant: "success" });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to delete user");
    } finally {
      setSubmitting(false);
    }
  };

  const handleActivate = async (user: AdminUser) => {
    setSubmitting(true);
    try {
      await apiFetch(`/api/admin/users/${user.id}/activate`, { method: "POST" });
      setConfirmActivateId(null);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, status: "ACTIVE" as const } : u)));
      setSelected((prev) => (prev?.id === user.id ? { ...prev, status: "ACTIVE" as const } : prev));
      toast({ title: "User activated", variant: "success" });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to activate user");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Manage Users</h1>
          <p className="text-sm text-text-secondary mt-0.5">Add new admins, staff, and residents. View existing accounts below.</p>
        </div>
        <Button onClick={() => { setShowAdd(true); setFormError(null); }} className="gap-1.5 px-3 min-h-10 text-sm shrink-0">
          <Plus size={16} /> Add User
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatsCard title="Admins" value={admins} accent="primary" icon={ShieldCheck} />
        <StatsCard title="Staff" value={staff} accent="info" icon={Wrench} />
        <StatsCard title="Pending" value={pending} accent="warning" icon={Clock} />
        <StatsCard title="Total" value={users.length} accent="success" icon={Users} />
      </div>

      <SearchBar value={search} onChange={setSearch} placeholder="Search email or role..." />
      <TabBar tabs={tabs} active={tab} onChange={(k) => setTab(k as Tab)} />

      {fetchError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{fetchError}</div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState title="No users" description="No users match your search" />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((user) => (
            <Card key={user.id} onClick={() => { setSelected(user); setConfirmDeleteId(null); setConfirmActivateId(null); setFormError(null); }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary-50 flex items-center justify-center shrink-0">
                  {user.role === "admin"
                    ? <ShieldCheck size={18} className="text-primary-500" />
                    : user.role === "resident"
                    ? <Home size={18} className="text-primary-500" />
                    : <Wrench size={18} className="text-primary-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{user.full_name || user.email}</p>
                  <p className="text-xs text-text-secondary capitalize">{user.role}</p>
                </div>
                <Badge variant={user.status === "ACTIVE" ? "success" : "danger"}>
                  {user.status === "ACTIVE" ? "Active" : "Inactive"}
                </Badge>
                <div className="hidden lg:flex items-center gap-0.5 ml-2">
                  {user.status === "INACTIVE" && (
                    <button
                      title="Activate"
                      onClick={(e) => { e.stopPropagation(); handleActivate(user); }}
                      className="p-1.5 rounded-md hover:bg-green-50 transition-colors text-text-secondary hover:text-green-600 cursor-pointer"
                    >
                      <CheckCircle size={15} />
                    </button>
                  )}
                  <button
                    title="Edit"
                    onClick={(e) => { e.stopPropagation(); openEdit(user); }}
                    className="p-1.5 rounded-md hover:bg-primary-50 transition-colors text-text-secondary hover:text-primary-500 cursor-pointer"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    title="Delete"
                    onClick={(e) => { e.stopPropagation(); setConfirmAction({ action: () => handleDelete(user), title: "Delete User?", description: `Permanently delete ${user.full_name || user.email}?` }); }}
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

      <ShowMoreButton hasMore={hasMore} isLoading={loadingMore} onLoadMore={loadMoreUsers} loadedCount={users.length} />

      {/* Detail BottomSheet */}
      <BottomSheet open={!!selected} onClose={() => { setSelected(null); setConfirmDeleteId(null); setConfirmActivateId(null); setFormError(null); }} title="User Details">
        {selected && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col items-center gap-2 pb-3">
              <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center">
                {selected.role === "admin"
                  ? <ShieldCheck size={28} className="text-primary-600" />
                  : selected.role === "resident"
                  ? <Home size={28} className="text-primary-600" />
                  : <Wrench size={28} className="text-primary-600" />}
              </div>
              <p className="font-bold">{selected.full_name || selected.email}</p>
            </div>
            {[
              { label: "Email", value: selected.email },
              { label: "Name", value: selected.full_name || "\u2014" },
              { label: "Role", value: selected.role },
              ...(selected.unit_number ? [{ label: "Unit", value: selected.unit_number }] : []),
            ].map((row) => (
              <div key={row.label} className="flex justify-between text-sm">
                <span className="text-text-secondary">{row.label}</span>
                <span className="font-medium capitalize">{row.value}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm items-center">
              <span className="text-text-secondary">Status</span>
              <Badge variant={selected.status === "ACTIVE" ? "success" : "danger"}>
                {selected.status === "ACTIVE" ? "Active" : "Inactive"}
              </Badge>
            </div>

            {formError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{formError}</div>
            )}

            {/* Activate */}
            {selected.status === "INACTIVE" && (
              confirmActivateId === selected.id ? (
                <div className="flex flex-col gap-2 p-3 bg-green-50 rounded-[10px] border border-green-200">
                  <p className="text-sm font-medium">Activate this account? A login email will be sent.</p>
                  <div className="flex gap-2">
                    <Button variant="secondary" className="flex-1" onClick={() => setConfirmActivateId(null)}>Cancel</Button>
                    <Button className="flex-1 gap-1" loading={submitting} onClick={() => handleActivate(selected)}>
                      <CheckCircle size={16} /> Confirm
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="outline" className="w-full gap-2" onClick={() => setConfirmActivateId(selected.id)}>
                  <CheckCircle size={16} /> Activate Account
                </Button>
              )
            )}

            {/* Edit / Delete */}
            {confirmDeleteId === selected.id ? (
              <div className="flex flex-col gap-2 p-3 bg-red-50 rounded-[10px] border border-red-200">
                <p className="text-sm font-medium">Permanently delete this user?</p>
                <div className="flex gap-2">
                  <Button variant="secondary" className="flex-1" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
                  <Button variant="danger" className="flex-1" loading={submitting} onClick={() => handleDelete(selected)}>
                    Confirm Delete
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1 gap-1 text-danger" onClick={() => setConfirmDeleteId(selected.id)}>
                  <Trash2 size={16} /> Delete
                </Button>
                <Button variant="secondary" className="flex-1 gap-1" onClick={() => openEdit(selected)}>
                  <Pencil size={16} /> Edit
                </Button>
              </div>
            )}
          </div>
        )}
      </BottomSheet>

      {/* Add User BottomSheet */}
      <BottomSheet open={showAdd} onClose={() => { setShowAdd(false); setFormError(null); }} title="Add User">
        <form onSubmit={handleAdd} className="flex flex-col gap-3">
          {formError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{formError}</div>
          )}
          <div>
            <label className="text-sm font-medium text-text-primary mb-1.5 block">Role</label>
            <div className="flex gap-2">
              {(["admin", "staff", "resident"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setAddForm((f) => ({ ...f, role: r }))}
                  className={`flex-1 py-2 rounded-[10px] text-sm font-medium capitalize transition-all cursor-pointer ${
                    addForm.role === r ? "bg-primary-500 text-white" : "bg-surface-dim text-text-secondary"
                  }`}
                >{r}</button>
              ))}
            </div>
          </div>
          <Input label="Full Name" icon={User} placeholder="Jane Doe" value={addForm.fullName} onChange={(e) => setAddForm((f) => ({ ...f, fullName: e.target.value }))} required />
          <Input label="Email" icon={Mail} type="email" placeholder="Email" value={addForm.email} onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))} required />
          {addForm.role === "resident" && (
            <Input label="Unit Number" icon={Building} placeholder="4052" value={addForm.unitNumber} onChange={(e) => setAddForm((f) => ({ ...f, unitNumber: e.target.value }))} required />
          )}
          <Input label="Password" icon={Lock} type="password" placeholder="••••••••" value={addForm.password} onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))} required />
          <Button type="submit" loading={submitting} className="w-full mt-2">
            Create {addForm.role.charAt(0).toUpperCase() + addForm.role.slice(1)}
          </Button>
        </form>
      </BottomSheet>

      {/* Edit User BottomSheet */}
      <BottomSheet open={!!editingUser} onClose={() => { setEditingUser(null); setFormError(null); }} title="Edit User">
        {editingUser && (
          <form onSubmit={handleEdit} className="flex flex-col gap-3">
            {formError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{formError}</div>
            )}
            <Input label="Email" icon={Mail} type="email" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} required />
            <div>
              <label className="text-sm font-medium text-text-primary mb-1.5 block">Role</label>
              <div className="flex gap-2">
                {(["admin", "staff"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setEditForm((f) => ({ ...f, role: r }))}
                    className={`flex-1 py-2 rounded-[10px] text-sm font-medium capitalize transition-all cursor-pointer ${
                      editForm.role === r ? "bg-primary-500 text-white" : "bg-surface-dim text-text-secondary"
                    }`}
                  >{r}</button>
                ))}
              </div>
            </div>
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
