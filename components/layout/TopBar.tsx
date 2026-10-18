"use client";

import { useState } from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/stores/authStore";
import { getInitials } from "@/lib/helpers";
import BottomSheet from "@/components/ui/BottomSheet";
import Button from "@/components/ui/Button";
import {
  ChevronRight, LogOut, Building,
} from "lucide-react";

const breadcrumbLabels: Record<string, string> = {
  dashboard: "Dashboard",
  guests: "Guest Manager",
  residents: "Residents",
  parking: "Parking",
  history: "Guest History",
  users: "Manage Users",
  more: "More",
  passes: "Passes",
  vehicles: "Vehicles",
  profile: "Profile",
};

function getBreadcrumbs(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  const crumbs: { label: string; href: string }[] = [];

  if (parts[0] === "admin") {
    crumbs.push({ label: "Admin", href: "/admin/dashboard" });
    if (parts[1] && parts[1] !== "dashboard") {
      crumbs.push({
        label: breadcrumbLabels[parts[1]] || parts[1],
        href: `/admin/${parts[1]}`,
      });
    }
  } else if (parts[0] === "staff") {
    crumbs.push({ label: "Staff", href: "/staff/dashboard" });
    if (parts[1] && parts[1] !== "dashboard") {
      crumbs.push({
        label: breadcrumbLabels[parts[1]] || parts[1],
        href: `/staff/${parts[1]}`,
      });
    }
  } else if (parts[0] === "dashboard") {
    crumbs.push({ label: "Resident", href: "/dashboard" });
    if (parts[1]) {
      crumbs.push({
        label: breadcrumbLabels[parts[1]] || parts[1],
        href: `/dashboard/${parts[1]}`,
      });
    }
  }

  return crumbs;
}

export default function TopBar() {
  const { session, logout } = useAuthStore();
  const pathname = usePathname();
  const router = useRouter();
  const breadcrumbs = getBreadcrumbs(pathname);

  const [showMenu, setShowMenu] = useState(false);

  const handleLogout = async () => {
    setShowMenu(false);
    await logout();
    router.push("/");
  };

  return (
    <>
      <header
        className="fixed top-0 inset-x-0 lg:left-56 z-50 h-14 bg-white/80 backdrop-blur-lg border-b border-border flex items-center justify-between px-4 lg:px-8"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        {/* Mobile: logo + brand */}
        <div className="flex items-center gap-2 lg:hidden">
          <Image src="/aura-apache-logo.webp" alt="Aura Parking" width={32} height={32} className="rounded-lg" />
          <span className="font-bold text-text-primary text-sm">Aura Parking</span>
        </div>

        {/* Desktop: breadcrumbs */}
        <nav className="hidden lg:flex items-center gap-1.5 text-sm">
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight size={14} className="text-text-secondary" />}
              {i === breadcrumbs.length - 1 ? (
                <span className="font-semibold text-text-primary">{crumb.label}</span>
              ) : (
                <Link href={crumb.href} className="text-text-secondary hover:text-primary-500 transition-colors">
                  {crumb.label}
                </Link>
              )}
            </span>
          ))}
        </nav>

        {/* User avatar (clickable → opens account menu) */}
        {session && (
          <div className="flex items-center gap-3">
            <div className="hidden lg:block text-right">
              <p className="text-sm font-medium text-text-primary leading-tight">
                Hello, {session.user.fullName.split(" ")[0]}
              </p>
              <p className="text-[11px] text-text-secondary capitalize">
                {session.user.role}
              </p>
            </div>
            <button
              onClick={() => setShowMenu(true)}
              className="w-9 h-9 rounded-[10px] bg-primary-100 flex items-center justify-center cursor-pointer hover:bg-primary-200 transition-colors"
              aria-label="Account menu"
            >
              <span className="text-primary-600 font-bold text-xs">
                {getInitials(session.user.fullName)}
              </span>
            </button>
          </div>
        )}
      </header>

      {/* Account Menu Sheet */}
      <BottomSheet open={showMenu} onClose={() => setShowMenu(false)} title="Account">
        {session && (
          <div className="flex flex-col gap-3">
            {/* Profile info */}
            <div className="flex items-center gap-3 pb-3 border-b border-border">
              <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                <span className="text-primary-600 font-bold text-base">
                  {getInitials(session.user.fullName)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm truncate">{session.user.fullName}</p>
                <p className="text-xs text-text-secondary">{session.user.email}</p>
                {session.user.unitNumber && (
                  <span className="text-[11px] text-text-secondary flex items-center gap-1 mt-0.5">
                    <Building size={11} /> Unit {session.user.unitNumber}
                  </span>
                )}
              </div>
            </div>

            <Button variant="danger" onClick={handleLogout} className="w-full gap-2">
              <LogOut size={18} />
              Sign Out
            </Button>
          </div>
        )}
      </BottomSheet>

    </>
  );
}
