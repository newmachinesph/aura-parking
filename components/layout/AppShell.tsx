"use client";

import TopBar from "./TopBar";
import BottomNav from "./BottomNav";
import Sidebar from "./Sidebar";
import SupportWidget from "@/components/shared/SupportWidget";
import { useAuthStore } from "@/stores/authStore";
import { NAV_CONFIG } from "@/lib/navigation";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.role);
  const navItems = role ? NAV_CONFIG[role] : [];

  return (
    <div className="flex min-h-[100dvh] bg-surface">
      {/* Skip to content — visible on focus for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary-500 focus:text-white focus:rounded-lg focus:text-sm focus:font-medium"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <Sidebar items={navItems} />

      {/* Main content area — shifted right on desktop when sidebar is visible */}
      <div className="flex flex-col flex-1 min-w-0 lg:ml-56">
        <TopBar />
        <main id="main-content" className="flex-1 overflow-y-auto overflow-x-hidden pb-20 lg:pb-6 pt-14 px-4 md:px-6 lg:px-8">
          <div className="animate-fade-in max-w-5xl mx-auto">{children}</div>
        </main>
        <BottomNav items={navItems} />
        <SupportWidget />
      </div>
    </div>
  );
}
