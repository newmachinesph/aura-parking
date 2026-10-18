"use client";

import Link from "next/link";
import Image from "next/image";
import { UserPlus, LogIn, ArrowLeft } from "lucide-react";
import Button from "@/components/ui/Button";

export default function UserGateway() {
  return (
    <div className="bg-white rounded-[10px] border border-border overflow-hidden px-6 sm:px-8 py-6 w-full max-w-md">
      <Link href="/" className="inline-flex text-text-secondary hover:text-primary-500 transition-colors mb-4">
        <ArrowLeft size={22} />
      </Link>

      <div className="flex flex-col items-center gap-2 mb-6">
        <Image src="/assets/img/aura-apache-primary-logo.webp" alt="Aura Apache" width={150} height={40} className="h-8 w-auto" />
        <h1 className="text-xl font-black">Resident Account</h1>
        <p className="text-sm text-text-secondary text-center">
          Please <strong>login</strong> or <strong>register</strong> to your resident account.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Link href="/register" className="w-full">
          <Button className="w-full gap-3">
            <UserPlus size={18} />
            Register
          </Button>
        </Link>
        <span className="text-[10px] text-text-secondary text-center -mt-1">First time user</span>

        <Link href="/login" className="w-full">
          <Button variant="outline" className="w-full gap-3">
            <LogIn size={18} />
            Log In
          </Button>
        </Link>
      </div>
    </div>
  );
}
