"use client";

import Link from "next/link";
import Image from "next/image";
import { ShieldCheck, ShieldUser, Briefcase } from "lucide-react";

export default function ManagementChoicePage() {
  return (
    <div className="bg-white rounded-[10px] border border-border overflow-hidden px-6 sm:px-8 py-6 w-full max-w-sm text-center">
      {/* Illustration */}
      <div className="flex items-center justify-center mb-2">
        <Image
          src="/assets/img/aura-apache-role.png"
          alt="Management Portal"
          width={180}
          height={180}
          className="w-[180px] h-auto"
        />
      </div>

      {/* Heading */}
      <h2 className="text-xl font-black text-text-primary mb-1">Management Portal</h2>
      <p className="text-sm text-text-secondary m-0">Select your role to continue</p>

      {/* Role Buttons */}
      <div className="grid grid-cols-2 gap-3 py-4">
        <Link href="/admin/login" className="no-underline">
          <div className="group relative bg-surface-dim rounded-[10px] h-[120px] flex items-center justify-center transition-all hover:shadow-[0_0_5px_rgba(0,0,0,0.5)] hover:scale-105 hover:-rotate-1 cursor-pointer overflow-hidden">
            <div className="flex flex-col items-center gap-1.5 text-text-primary transition-colors group-hover:text-white z-10">
              <ShieldUser size={35} />
              <span className="text-sm font-medium">Admin</span>
            </div>
            <div className="absolute inset-0 bg-primary-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </Link>
        <Link href="/staff/login" className="no-underline">
          <div className="group relative bg-surface-dim rounded-[10px] h-[120px] flex items-center justify-center transition-all hover:shadow-[0_0_5px_rgba(0,0,0,0.5)] hover:scale-105 hover:-rotate-1 cursor-pointer overflow-hidden">
            <div className="flex flex-col items-center gap-1.5 text-text-primary transition-colors group-hover:text-white z-10">
              <Briefcase size={35} />
              <span className="text-sm font-medium">Staff</span>
            </div>
            <div className="absolute inset-0 bg-primary-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </Link>
      </div>

      {/* Disclaimer */}
      <div className="flex items-center justify-center gap-1.5 text-text-secondary mt-2">
        <ShieldCheck size={15} />
        <small className="text-[13px]">Your information is safe and securely encrypted.</small>
      </div>
    </div>
  );
}
