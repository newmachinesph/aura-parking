"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import type { NavItem } from "@/lib/navigation";

interface BottomNavProps {
  items: NavItem[];
}

export default function BottomNav({ items }: BottomNavProps) {
  const pathname = usePathname();
  const mobileItems = items.filter((item) => !item.desktopOnly);

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-50 bg-white/80 backdrop-blur-lg border-t border-border lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex justify-around items-center h-16 max-w-lg mx-auto">
        {mobileItems.map((item) => {
          const basePath = item.path.split("?")[0];
          const isActive =
            item.key === "home"
              ? pathname === basePath
              : pathname.startsWith(basePath);

          return (
            <Link
              key={item.key}
              href={item.path}
              aria-current={isActive ? "page" : undefined}
              className={clsx(
                "flex flex-col items-center justify-center gap-0.5 min-w-12 min-h-12 rounded-[10px] transition-all duration-200",
                isActive ? "text-primary-500" : "text-text-secondary"
              )}
            >
              <div
                className={clsx(
                  "flex items-center justify-center w-10 h-7 rounded-full transition-all duration-200",
                  isActive && "bg-primary-100"
                )}
              >
                <item.icon size={20} strokeWidth={isActive ? 2.5 : 1.5} />
              </div>
              <span
                className={clsx(
                  "text-[10px] leading-tight",
                  isActive ? "font-bold" : "font-normal"
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
