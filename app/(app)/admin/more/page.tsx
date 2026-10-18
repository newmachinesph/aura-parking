"use client";

import { useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import BottomSheet from "@/components/ui/BottomSheet";
import { apiFetch, ApiError } from "@/lib/api";
import {
  LogOut, Settings, Info, UserCog, History, Mail,
  Shield, User, Lock, ChevronRight, DollarSign, Clock,
} from "lucide-react";
import { RATE_PER_DAY, FREE_PASS_DAYS } from "@/lib/constants";
import { getInitials } from "@/lib/helpers";
import { useToast } from "@/components/ui/Toast";

export default function AdminMore() {
  const { session, logout } = useAuthStore();
  const router = useRouter();

  const { toast } = useToast();

  // Change password
  const [showPassword, setShowPassword] = useState(false);
  const [pwForm, setPwForm] = useState({ current: "", newPw: "", confirm: "" });
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);

  // About
  const [showAbout, setShowAbout] = useState(false);

  const handleLogout = async () => {
    await logout();
    router.push("/");
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    if (pwForm.newPw !== pwForm.confirm) {
      setPwError("New passwords do not match");
      return;
    }
    if (pwForm.newPw.length < 8) {
      setPwError("Password must be at least 8 characters");
      return;
    }
    setPwLoading(true);
    try {
      await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: pwForm.current,
          newPassword: pwForm.newPw,
        }),
      });
      setPwSuccess(true);
      setPwForm({ current: "", newPw: "", confirm: "" });
      toast({ title: "Password updated", variant: "success" });
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : "Failed to change password");
      toast({ title: "Password change failed", description: err instanceof ApiError ? err.message : "Failed to change password", variant: "error" });
    } finally {
      setPwLoading(false);
    }
  };

  const menuItems = [
    {
      icon: User,
      label: "Profile",
      desc: session?.user.fullName || "View your account",
      onClick: () => {},
      isProfile: true,
    },
    {
      icon: UserCog,
      label: "Manage Users",
      desc: "Admin, staff & resident accounts",
      onClick: () => router.push("/admin/users"),
    },
    {
      icon: History,
      label: "Guest History",
      desc: "View all past guest stays",
      onClick: () => router.push("/admin/history"),
    },
    {
      icon: Lock,
      label: "Change Password",
      desc: "Update your login password",
      onClick: () => { setShowPassword(true); setPwError(null); setPwSuccess(false); },
    },
    {
      icon: Info,
      label: "About",
      desc: "App info & system settings",
      onClick: () => setShowAbout(true),
    },
  ];

  return (
    <div className="flex flex-col gap-4 py-4">
      <h1 className="text-xl font-bold">More</h1>

      {/* Profile header */}
      <div className="flex items-center gap-4 p-4 bg-surface-container rounded-[10px]">
        <div className="w-14 h-14 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
          <span className="text-primary-600 font-black text-xl">
            {session ? getInitials(session.user.fullName) : ""}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold truncate">{session?.user.fullName}</p>
          <p className="text-sm text-text-secondary">{session?.user.email}</p>
          <p className="text-xs text-text-secondary capitalize mt-0.5">{session?.user.role}</p>
        </div>
      </div>

      {/* Menu items */}
      <div className="flex flex-col gap-2">
        {menuItems.filter((m) => !m.isProfile).map((item) => (
          <Card key={item.label} onClick={item.onClick}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-surface-dim flex items-center justify-center shrink-0">
                <item.icon size={18} className="text-text-secondary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{item.label}</p>
                <p className="text-xs text-text-secondary truncate">{item.desc}</p>
              </div>
              <ChevronRight size={16} className="text-text-secondary shrink-0" />
            </div>
          </Card>
        ))}
      </div>

      <Button variant="danger" onClick={handleLogout} className="w-full gap-2 mt-4">
        <LogOut size={18} />
        Sign Out
      </Button>

      {/* Change Password Sheet */}
      <BottomSheet open={showPassword} onClose={() => setShowPassword(false)} title="Change Password">
        {pwSuccess ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
              <Lock size={24} className="text-green-600" />
            </div>
            <p className="font-semibold">Password Updated</p>
            <p className="text-sm text-text-secondary text-center">Your password has been changed successfully.</p>
            <Button className="w-full mt-2" onClick={() => setShowPassword(false)}>Done</Button>
          </div>
        ) : (
          <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
            {pwError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{pwError}</div>
            )}
            <Input
              label="Current Password"
              icon={Lock}
              type="password"
              placeholder="Enter current password"
              value={pwForm.current}
              onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))}
              required
            />
            <Input
              label="New Password"
              icon={Lock}
              type="password"
              placeholder="Enter new password"
              value={pwForm.newPw}
              onChange={(e) => setPwForm((f) => ({ ...f, newPw: e.target.value }))}
              required
            />
            <Input
              label="Confirm New Password"
              icon={Lock}
              type="password"
              placeholder="Re-enter new password"
              value={pwForm.confirm}
              onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))}
              required
            />
            <Button type="submit" loading={pwLoading} className="w-full mt-2">Update Password</Button>
          </form>
        )}
      </BottomSheet>

      {/* About Sheet */}
      <BottomSheet open={showAbout} onClose={() => setShowAbout(false)} title="About">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-2 py-3">
            <div className="w-16 h-16 rounded-[14px] bg-primary-100 flex items-center justify-center">
              <Settings size={28} className="text-primary-600" />
            </div>
            <p className="font-bold text-lg">Aura Parking</p>
            <p className="text-sm text-text-secondary">v2.0</p>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">System Settings</p>
            <div className="bg-surface-dim rounded-[10px] p-3 flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Clock size={14} className="text-text-secondary" />
                  <span className="text-text-secondary">Free Passes / Month</span>
                </div>
                <span className="font-semibold">{FREE_PASS_DAYS}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <DollarSign size={14} className="text-text-secondary" />
                  <span className="text-text-secondary">Rate Per Day</span>
                </div>
                <span className="font-semibold">${RATE_PER_DAY}</span>
              </div>
            </div>
          </div>

          <p className="text-xs text-text-secondary text-center mt-2">
            Built for Apache RV Park
          </p>
        </div>
      </BottomSheet>
    </div>
  );
}
