"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Mail, Lock, ArrowLeft } from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useAuthStore } from "@/stores/authStore";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { login, isLoading, error, clearError } = useAuthStore();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(email, password);
      const role = useAuthStore.getState().role;
      if (role !== "admin") {
        await useAuthStore.getState().logout();
        useAuthStore.setState({ error: "This login is for admins only. Please use the staff login." });
        return;
      }
      router.push("/admin/dashboard");
    } catch {
      // error is already set in the store
    }
  };

  return (
    <div className="bg-white rounded-[10px] border border-border overflow-hidden px-6 sm:px-8 py-6 w-full max-w-md">
      <Link href="/ops" className="inline-flex text-text-secondary hover:text-primary-500 transition-colors mb-4">
        <ArrowLeft size={22} />
      </Link>

      <div className="flex flex-col items-center gap-2 mb-6">
        <Image src="/assets/img/aura-apache-primary-logo.webp" alt="Aura Apache" width={150} height={40} className="h-8 w-auto" />
        <h1 className="text-xl font-black">Admin Login</h1>
        <p className="text-sm text-text-secondary">Sign in to the admin portal</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3 mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input label="Email" icon={Mail} type="email" placeholder="Email" value={email} onChange={(e) => { setEmail(e.target.value); clearError(); }} required />
        <Input label="Password" icon={Lock} type="password" placeholder="Password" value={password} onChange={(e) => { setPassword(e.target.value); clearError(); }} required />
        <Button type="submit" loading={isLoading} className="w-full">Sign In</Button>
      </form>

      <div className="flex items-center justify-center gap-2 mt-5 text-sm">
        <Link href="/forgot-password" className="text-primary-500 font-medium">Forgot password?</Link>
        <span className="text-text-secondary">|</span>
        <Link href="/admin/register" className="text-primary-500 font-medium">Register</Link>
      </div>
    </div>
  );
}
