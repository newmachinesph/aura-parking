"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { User, Mail, Lock, Check, X } from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { apiFetch, ApiError } from "@/lib/api";

function getPasswordChecks(password: string) {
  return [
    { label: "At least 8 characters", met: password.length >= 8 },
    { label: "One uppercase letter", met: /[A-Z]/.test(password) },
    { label: "One number", met: /\d/.test(password) },
    { label: "One special character", met: /[^A-Za-z0-9]/.test(password) },
  ];
}

export default function AdminRegister() {
  const [form, setForm] = useState({ fullName: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const passwordChecks = getPasswordChecks(form.password);
  const passwordValid = form.password.length > 0 && passwordChecks.every((c) => c.met);

  const update = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordValid) { setApiError("Password does not meet all requirements"); return; }
    setLoading(true);
    setApiError(null);
    try {
      await apiFetch("/api/auth/register-admin", {
        method: "POST",
        body: JSON.stringify({
          fullName: form.fullName,
          email: form.email,
          password: form.password,
          role: "admin",
        }),
      });
      setDone(true);
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="bg-white rounded-[10px] border border-border overflow-hidden px-6 sm:px-8 py-6 w-full max-w-md text-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
            <Check size={32} className="text-success" />
          </div>
          <h1 className="text-xl font-black">Registration Submitted</h1>
          <p className="text-sm text-text-secondary">
            Your admin account has been created and is pending approval. You&apos;ll receive an email once activated.
          </p>
          <Link href="/admin/login"><Button className="w-full">Go to Login</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-[10px] border border-border overflow-hidden px-6 sm:px-8 py-6 w-full max-w-md">
      <div className="flex flex-col items-center gap-2 mb-6">
        <Image src="/assets/img/aura-apache-primary-logo.webp" alt="Aura Apache" width={150} height={40} className="h-8 w-auto" />
        <h1 className="text-xl font-black">Admin Registration</h1>
        <p className="text-sm text-text-secondary">Create your admin account</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {apiError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{apiError}</div>
        )}

        <Input label="Full Name" icon={User} placeholder="Your Name" value={form.fullName} onChange={(e) => update("fullName", e.target.value)} required />
        <Input label="Email" icon={Mail} type="email" placeholder="Email" value={form.email} onChange={(e) => update("email", e.target.value)} required />
        <div>
          <Input label="Password" icon={Lock} type="password" placeholder="Password" value={form.password} onChange={(e) => update("password", e.target.value)} required />
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2">
            {passwordChecks.map((check) => (
              <p key={check.label} className={`flex items-center gap-1 text-xs ${!form.password ? "text-text-secondary" : check.met ? "text-success" : "text-danger"}`}>
                {form.password ? (check.met ? <Check size={12} /> : <X size={12} />) : <span className="w-3 h-3 rounded-full border border-current inline-block shrink-0" />}
                {check.label}
              </p>
            ))}
          </div>
        </div>
        <Button type="submit" loading={loading} disabled={!passwordValid} className="w-full mt-2">Submit Registration</Button>
      </form>

      <div className="flex items-center justify-center gap-2 mt-5 text-sm">
        <Link href="/admin/login" className="text-primary-500 font-medium">Already have an account?</Link>
        <span className="text-text-secondary">|</span>
        <Link href="/ops" className="text-primary-500 font-medium">Back</Link>
      </div>
    </div>
  );
}
