"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { clsx } from "clsx";
import { LogOut } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { getInitials } from "@/lib/helpers";
import type { NavItem } from "@/lib/navigation";

interface SidebarProps {
  items: NavItem[];
}

export default function Sidebar({ items }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const { logout } = useAuthStore();

  const handleLogout = async () => {
    await logout();
    router.push("/");
  };

  return (
    <aside className="hidden lg:flex flex-col w-56 fixed inset-y-0 left-0 z-40 bg-primary-800 text-white">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-primary-700">
        <Image
          src="/aura-apache-logo.webp"
          alt="Aura Parking"
          width={32}
          height={32}
          className="rounded-lg"
        />
        <span className="font-bold text-sm tracking-wide">AURA PARKING</span>
      </div>

      {/* User info */}
      {session && (
        <div className="flex items-center gap-3 px-5 py-4 border-b border-primary-700">
          <div className="w-9 h-9 rounded-full bg-primary-400/30 flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-xs">
              {getInitials(session.user.fullName)}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{session.user.fullName}</p>
            <p className="text-[11px] text-primary-300 capitalize">{session.user.role}</p>
          </div>
        </div>
      )}

      {/* Nav items */}
      <nav className="flex-1 py-3 px-3 flex flex-col gap-0.5 overflow-y-auto">
        {items
          .filter((item) => item.key !== "more")
          .map((item) => {
            const linkPath = item.desktopPath || item.path;
            const linkLabel = item.desktopLabel || item.label;
            const basePath = linkPath.split("?")[0];
            const isActive =
              item.key === "home"
                ? pathname === basePath
                : pathname.startsWith(basePath);

            return (
              <Link
                key={item.key}
                href={linkPath}
                aria-current={isActive ? "page" : undefined}
                className={clsx(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all",
                  isActive
                    ? "bg-white/15 text-white font-semibold"
                    : "text-primary-200 hover:bg-white/8 hover:text-white"
                )}
              >
                <item.icon size={18} strokeWidth={isActive ? 2.5 : 1.5} />
                <span>{linkLabel}</span>
              </Link>
            );
          })}
      </nav>

      {/* Footer */}
      <div className="px-3 pb-4 flex flex-col gap-0.5">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-primary-300 hover:bg-white/8 hover:text-white transition-all w-full cursor-pointer"
        >
          <LogOut size={18} />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
