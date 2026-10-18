"use client";

import { useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import BottomSheet from "@/components/ui/BottomSheet";
import { apiFetch, ApiError } from "@/lib/api";
import { LogOut, Mail, Shield, Lock } from "lucide-react";
import { getInitials } from "@/lib/helpers";

export default function StaffProfile() {
  const { session, role, logout } = useAuthStore();
  const router = useRouter();

  const [showPassword, setShowPassword] = useState(false);
  const [pwForm, setPwForm] = useState({ current: "", newPw: "", confirm: "" });
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);

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
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : "Failed to change password");
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 py-4">
      <h1 className="text-xl font-bold">Profile</h1>

      <div className="flex flex-col items-center gap-3 py-4">
        <div className="w-20 h-20 rounded-full bg-primary-100 flex items-center justify-center">
          <span className="text-primary-600 font-black text-2xl">
            {session ? getInitials(session.user.fullName) : ""}
          </span>
        </div>
        <div className="text-center">
          <p className="font-bold text-lg">{session?.user.fullName}</p>
          <p className="text-sm text-text-secondary capitalize">{role}</p>
        </div>
      </div>

      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Mail size={18} className="text-text-secondary" />
            <div>
              <p className="text-xs text-text-secondary">Email</p>
              <p className="text-sm font-medium">{session?.user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Shield size={18} className="text-text-secondary" />
            <div>
              <p className="text-xs text-text-secondary">Role</p>
              <p className="text-sm font-medium capitalize">{role}</p>
            </div>
          </div>
        </div>
      </Card>

      <Button variant="secondary" onClick={() => { setShowPassword(true); setPwError(null); setPwSuccess(false); }} className="w-full gap-2">
        <Lock size={18} />
        Change Password
      </Button>

      <Button variant="danger" onClick={handleLogout} className="w-full gap-2">
        <LogOut size={18} />
        Sign Out
      </Button>

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
            <Input label="Current Password" icon={Lock} type="password" placeholder="Enter current password" value={pwForm.current} onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))} required />
            <Input label="New Password" icon={Lock} type="password" placeholder="Enter new password" value={pwForm.newPw} onChange={(e) => setPwForm((f) => ({ ...f, newPw: e.target.value }))} required />
            <Input label="Confirm New Password" icon={Lock} type="password" placeholder="Re-enter new password" value={pwForm.confirm} onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))} required />
            <Button type="submit" loading={pwLoading} className="w-full mt-2">Update Password</Button>
          </form>
        )}
      </BottomSheet>
    </div>
  );
}
