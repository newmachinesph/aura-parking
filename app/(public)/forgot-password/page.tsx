"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Mail, ArrowLeft, Phone } from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { apiFetch, ApiError } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send reset link");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-[10px] border border-border overflow-hidden px-6 sm:px-8 py-6 w-full max-w-md">
      <Link href="/login" className="inline-flex text-text-secondary hover:text-primary-500 transition-colors mb-4">
        <ArrowLeft size={22} />
      </Link>

      <div className="flex flex-col items-center gap-2 mb-6">
        <Image src="/assets/img/aura-apache-primary-logo.webp" alt="Aura Apache" width={150} height={40} className="h-8 w-auto" />
        <h1 className="text-xl font-black">Reset Password</h1>
        <p className="text-sm text-text-secondary">Choose how you&apos;d like to recover your account.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3 mb-4">{error}</div>
      )}

      {sent ? (
        <div className="text-center flex flex-col gap-4">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <Mail size={28} className="text-success" />
          </div>
          <p className="text-sm text-text-secondary">Check your inbox for a password reset link.</p>
          <Link href="/login">
            <Button variant="outline" className="w-full">Back to Login</Button>
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input label="Email" icon={Mail} type="email" placeholder="Email" value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} required />
            <Button type="submit" loading={loading} className="w-full gap-2">
              <Mail size={16} /> Reset via Email
            </Button>
          </form>
          <Link href="/login" className="text-center text-sm text-primary-500 font-medium mt-2">
            Back to login
          </Link>
        </div>
      )}
    </div>
  );
}
