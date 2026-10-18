"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Lock, CheckCircle, ArrowLeft } from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { apiFetch, ApiError } from "@/lib/api";

function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords do not match"); return; }
    const pwRegex = /^(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
    if (!pwRegex.test(password)) { setError("Must be 8+ chars with at least one number and one symbol."); return; }
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, newPassword: password }),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="bg-white rounded-[10px] border border-border overflow-hidden px-6 sm:px-8 py-6 w-full max-w-md text-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle size={32} className="text-success" />
          </div>
          <h1 className="text-xl font-black">Password Updated</h1>
          <p className="text-sm text-text-secondary">Your password has been successfully reset.</p>
          <Button onClick={() => router.push("/login")} className="w-full">Go to Login</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-[10px] border border-border overflow-hidden px-6 sm:px-8 py-6 w-full max-w-md">
      <Link href="/login" className="inline-flex text-text-secondary hover:text-primary-500 transition-colors mb-4">
        <ArrowLeft size={22} />
      </Link>

      <div className="flex flex-col items-center gap-2 mb-6">
        <Image src="/assets/img/aura-apache-primary-logo.webp" alt="Aura Apache" width={150} height={40} className="h-8 w-auto" />
        <h1 className="text-xl font-black">New Password</h1>
        <p className="text-sm text-text-secondary">Choose a strong password</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3 mb-4">{error}</div>
      )}

      {!token && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-[10px] px-4 py-3 mb-4">
          Invalid reset link. Please request a new password reset.
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input label="New Password" icon={Lock} type="password" placeholder="Password" value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} required />
        <Input label="Confirm Password" icon={Lock} type="password" placeholder="Confirm Password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setError(null); }} required />
        <Button type="submit" loading={loading} disabled={!token} className="w-full">Reset Password</Button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="text-white">Loading...</div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
