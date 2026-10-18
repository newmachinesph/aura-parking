"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Mail, Lock, User, Building, Check, X, Phone, ArrowLeft } from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import PhoneInput from "@/components/ui/PhoneInput";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";

function getPasswordChecks(password: string) {
  return [
    { label: "At least 8 characters", met: password.length >= 8 },
    { label: "One uppercase letter", met: /[A-Z]/.test(password) },
    { label: "One number", met: /\d/.test(password) },
    { label: "One special character", met: /[^A-Za-z0-9]/.test(password) },
  ];
}

type Step = "form" | "verify";

export default function RegisterPage() {
  const [step, setStep] = useState<Step>("form");
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", unit: "", password: "" });
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const passwordChecks = getPasswordChecks(form.password);
  const passwordValid = form.password.length > 0 && passwordChecks.every((c) => c.met);

  const update = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setError(null);
  };

  const handleSendCode = async () => {
    if (!form.phone) return;
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/api/auth/send-verification", {
        method: "POST",
        body: JSON.stringify({ phone: form.phone }),
      });
      setStep("verify");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send verification code");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.unit.trim()) { setError("Unit number is required"); return; }
    if (!form.fullName.trim()) { setError("Full name is required"); return; }
    if (!form.email.trim()) { setError("Email is required"); return; }
    if (!passwordValid) { setError("Password does not meet all requirements"); return; }
    await handleSendCode();
  };

  const handleVerifyAndRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ user: { id: number; email: string; role: string; residentId: number | null; fullName: string; unitNumber: string | null } }>("/api/auth/register-resident", {
        method: "POST",
        body: JSON.stringify({
          unitNumber: form.unit,
          fullName: form.fullName,
          email: form.email,
          password: form.password,
          phone: form.phone,
          verificationCode: code,
        }),
      });
      // Auto-login: set session in store and redirect to dashboard
      useAuthStore.setState({
        session: { user: { ...data.user, role: data.user.role as "resident" } },
        role: "resident",
        initialized: true,
      });
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-[10px] border border-border overflow-hidden px-6 sm:px-8 py-6 w-full max-w-md">
      <Link href="/" className="inline-flex text-text-secondary hover:text-primary-500 transition-colors mb-4">
        <ArrowLeft size={22} />
      </Link>

      <div className="flex flex-col items-center gap-2 mb-6">
        <Image src="/assets/img/aura-apache-primary-logo.webp" alt="Aura Apache" width={150} height={40} className="h-8 w-auto" />
        <h1 className="text-xl font-black">Create Account</h1>
        <p className="text-sm text-text-secondary">
          {step === "form" ? "Register your resident account to get started." : "Enter the verification code"}
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3 mb-4">{error}</div>
      )}

      {step === "form" && (
        <form onSubmit={handleSubmitForm} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Unit Number" icon={Building} placeholder="Unit Number" value={form.unit} onChange={(e) => update("unit", e.target.value)} required />
            <Input label="Full Name" icon={User} placeholder="Full Name" value={form.fullName} onChange={(e) => update("fullName", e.target.value)} required />
          </div>
          <Input label="Email" icon={Mail} type="email" placeholder="Email" value={form.email} onChange={(e) => update("email", e.target.value)} required />
          <PhoneInput label="Phone" value={form.phone} onChange={(phone) => update("phone", phone)} />
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
          <Button type="submit" loading={loading} disabled={!passwordValid} className="w-full mt-2">
            Continue
          </Button>
        </form>
      )}

      {step === "verify" && (
        <form onSubmit={handleVerifyAndRegister} className="flex flex-col gap-4">
          <div className="bg-primary-50 rounded-[10px] p-3 text-sm">
            <p className="font-medium text-primary-700">Code sent to {form.phone}</p>
            <p className="text-xs text-primary-500">Enter the 6-digit code to verify your phone</p>
          </div>
          <Input label="Verification Code" icon={Phone} placeholder="123456" value={code} onChange={(e) => { setCode(e.target.value); setError(null); }} required />
          <Button type="submit" loading={loading} className="w-full">Create Account</Button>
          <button type="button" onClick={() => handleSendCode()} className="text-xs text-primary-500 font-medium text-center cursor-pointer">Resend code</button>
        </form>
      )}

      <p className="text-center text-sm text-text-secondary mt-5">
        Already have an account?{" "}
        <Link href="/login" className="text-primary-500 font-medium">Log In</Link>
      </p>
    </div>
  );
}
